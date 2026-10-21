#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <ole2.h>
#include <shlobj.h>
#include <shellapi.h>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <memory>
#include <node_api.h>
#include <delayimp.h>
#include <string>
#include <vector>

// Node-API imports belong to the host executable (Obsidian/Electron or Node).
static FARPROC WINAPI nodeApiDelayLoad(unsigned event, PDelayLoadInfo info) {
    if (event == dliNotePreLoadLibrary && !_stricmp(info->szDll, "node.exe"))
        return reinterpret_cast<FARPROC>(GetModuleHandleW(nullptr));
    return nullptr;
}
extern "C" const PfnDliHook __pfnDliNotifyHook2 = nodeApiDelayLoad;

struct Payload { uint32_t owner = 0; std::wstring text, textFile; std::vector<std::wstring> files; };
struct Target { HWND root = nullptr; DWORD pid = 0; bool chat = false, shell = false; };
struct Context {
    Payload payload;
    Target released;
    HWND sourceWindow = nullptr, filesReadTarget = nullptr;
    bool frozen = false, cancelled = false;
    uint32_t queryCount = 0;
};
class PacketReader {
    const unsigned char* cursor;
    size_t remaining;
public:
    PacketReader(const void* bytes, size_t length) : cursor(static_cast<const unsigned char*>(bytes)), remaining(length) {}
    bool read(void* output, size_t length) {
        if (length > remaining) return false;
        if (length) memcpy(output, cursor, length);
        cursor += length; remaining -= length; return true;
    }
    bool number(uint32_t& value) { return read(&value, sizeof(value)); }
    bool string(std::wstring& value) {
        uint32_t bytes;
        if (!number(bytes) || bytes % 2 || bytes > remaining || bytes > 32 * 1024 * 1024) return false;
        value.resize(bytes / 2); return read(value.data(), bytes);
    }
    bool ended() const { return remaining == 0; }
};
static bool readPayload(Payload& p, const void* bytes, size_t length) {
    PacketReader reader(bytes, length);
    char magic[4]; uint32_t count;
    if (!reader.read(magic, 4) || memcmp(magic, "JD01", 4)) return false;
    if (!reader.number(p.owner) || !reader.string(p.text) || !reader.string(p.textFile) || !reader.number(count) || count > 10000) return false;
    p.files.resize(count);
    for (auto& file : p.files) if (!reader.string(file)) return false;
    return reader.ended() && (!p.text.empty() || !p.files.empty());
}
static Target targetAtCursor() {
    POINT point; GetCursorPos(&point);
    HWND window = WindowFromPoint(point);
    Target t; t.root = GetAncestor(window, GA_ROOT);
    GetWindowThreadProcessId(t.root, &t.pid);
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, t.pid);
    if (process) {
        wchar_t path[32768]; DWORD size = ARRAYSIZE(path);
        if (QueryFullProcessImageNameW(process, 0, path, &size)) {
            const wchar_t* name = wcsrchr(path, L'\\'); name = name ? name + 1 : path;
            t.chat = !_wcsicmp(name, L"WXWork.exe") || !_wcsicmp(name, L"Weixin.exe") || !_wcsicmp(name, L"WeChat.exe");
            t.shell = !_wcsicmp(name, L"explorer.exe");
        }
        CloseHandle(process);
    }
    return t;
}
static Target target(const Context& c) { return c.frozen ? c.released : targetAtCursor(); }
static std::vector<std::wstring> offeredFiles(const Context& c) {
    if (c.cancelled || target(c).pid == c.payload.owner) return {};
    auto files = c.payload.files;
    // File destinations keep the body as a TXT. Chat receives editable text.
    if (!c.payload.text.empty() && target(c).shell && !c.payload.textFile.empty()) files.push_back(c.payload.textFile);
    return files;
}
static bool offersText(const Context& c) { const auto t = target(c); return !c.cancelled && t.pid != c.payload.owner && !c.payload.text.empty() && !(t.chat && !c.payload.files.empty()); }
static bool offersFiles(const Context& c) { return !offeredFiles(c).empty(); }

class DataObject final : public IDataObject {
    LONG refs = 1;
    std::shared_ptr<Context> retained;
    Context& context;
public:
    explicit DataObject(std::shared_ptr<Context> c) : retained(std::move(c)), context(*retained) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** out) override {
        if (!out) return E_POINTER; *out = nullptr;
        if (iid == IID_IUnknown || iid == IID_IDataObject) { *out = static_cast<IDataObject*>(this); AddRef(); return S_OK; }
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refs); }
    ULONG STDMETHODCALLTYPE Release() override { const auto n = InterlockedDecrement(&refs); if (!n) delete this; return n; }
    HRESULT STDMETHODCALLTYPE QueryGetData(FORMATETC* f) override {
        if (!f) return E_POINTER;
        if (f->dwAspect != DVASPECT_CONTENT || f->lindex != -1 || !(f->tymed & TYMED_HGLOBAL)) return DV_E_FORMATETC;
        if (f->cfFormat == CF_UNICODETEXT && offersText(context)) return S_OK;
        if (f->cfFormat == CF_HDROP && offersFiles(context)) return S_OK;
        return DV_E_FORMATETC;
    }
    HRESULT STDMETHODCALLTYPE GetData(FORMATETC* f, STGMEDIUM* medium) override {
        if (!medium) return E_POINTER;
        ZeroMemory(medium, sizeof(*medium));
        const auto result = QueryGetData(f); if (FAILED(result)) return result;
        HGLOBAL memory = nullptr;
        if (f->cfFormat == CF_UNICODETEXT) {
            const size_t bytes = (context.payload.text.size() + 1) * sizeof(wchar_t);
            memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, bytes);
            if (!memory) return E_OUTOFMEMORY;
            auto ptr = GlobalLock(memory); if (!ptr) { GlobalFree(memory); return E_OUTOFMEMORY; }
            memcpy(ptr, context.payload.text.c_str(), bytes); GlobalUnlock(memory);
        } else {
            const auto files = offeredFiles(context);
            size_t chars = 1; for (const auto& file : files) chars += file.size() + 1;
            memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, sizeof(DROPFILES) + chars * sizeof(wchar_t));
            if (!memory) return E_OUTOFMEMORY;
            auto drop = static_cast<DROPFILES*>(GlobalLock(memory));
            if (!drop) { GlobalFree(memory); return E_OUTOFMEMORY; }
            drop->pFiles = sizeof(DROPFILES); drop->fWide = TRUE;
            auto cursor = reinterpret_cast<wchar_t*>(reinterpret_cast<char*>(drop) + sizeof(DROPFILES));
            for (const auto& file : files) { memcpy(cursor, file.c_str(), (file.size() + 1) * sizeof(wchar_t)); cursor += file.size() + 1; }
            GlobalUnlock(memory);
            context.filesReadTarget = target(context).root;
        }
        medium->tymed = TYMED_HGLOBAL; medium->hGlobal = memory; return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetDataHere(FORMATETC*, STGMEDIUM*) override { return DATA_E_FORMATETC; }
    HRESULT STDMETHODCALLTYPE GetCanonicalFormatEtc(FORMATETC*, FORMATETC* out) override { if (out) out->ptd = nullptr; return E_NOTIMPL; }
    HRESULT STDMETHODCALLTYPE SetData(FORMATETC*, STGMEDIUM*, BOOL) override { return E_NOTIMPL; }
    HRESULT STDMETHODCALLTYPE EnumFormatEtc(DWORD direction, IEnumFORMATETC** out) override {
        if (direction != DATADIR_GET) return E_NOTIMPL;
        std::vector<FORMATETC> formats;
        if (offersFiles(context)) formats.push_back({ CF_HDROP, nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL });
        if (offersText(context)) formats.push_back({ CF_UNICODETEXT, nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL });
        return SHCreateStdEnumFmtEtc(static_cast<UINT>(formats.size()), formats.data(), out);
    }
    HRESULT STDMETHODCALLTYPE DAdvise(FORMATETC*, DWORD, IAdviseSink*, DWORD*) override { return OLE_E_ADVISENOTSUPPORTED; }
    HRESULT STDMETHODCALLTYPE DUnadvise(DWORD) override { return OLE_E_ADVISENOTSUPPORTED; }
    HRESULT STDMETHODCALLTYPE EnumDAdvise(IEnumSTATDATA**) override { return OLE_E_ADVISENOTSUPPORTED; }
};

class DropSource final : public IDropSource {
    LONG refs = 1;
    std::shared_ptr<Context> retained;
    Context& context;
public:
    explicit DropSource(std::shared_ptr<Context> c) : retained(std::move(c)), context(*retained) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** out) override {
        if (!out) return E_POINTER; *out = nullptr;
        if (iid == IID_IUnknown || iid == IID_IDropSource) *out = static_cast<IDropSource*>(this);
        else return E_NOINTERFACE;
        AddRef(); return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refs); }
    ULONG STDMETHODCALLTYPE Release() override { const auto n = InterlockedDecrement(&refs); if (!n) delete this; return n; }
    HRESULT STDMETHODCALLTYPE QueryContinueDrag(BOOL escape, DWORD keys) override {
        ++context.queryCount;
        if (escape || context.cancelled || !IsWindow(context.sourceWindow)) return DRAGDROP_S_CANCEL;
        if (!(keys & MK_LBUTTON)) {
            context.released = targetAtCursor(); context.frozen = true;
            if (!context.released.root || context.released.pid == context.payload.owner) return DRAGDROP_S_CANCEL;
            return DRAGDROP_S_DROP;
        }
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GiveFeedback(DWORD) override { return DRAGDROP_S_USEDEFAULTCURSORS; }
};

static bool sameForeground(const Context& c) {
    const HWND root = GetAncestor(GetForegroundWindow(), GA_ROOT);
    DWORD pid = 0; GetWindowThreadProcessId(root, &pid);
    return !c.cancelled && root && root == c.released.root && pid == c.released.pid && pid != c.payload.owner;
}
static bool waitTarget(const Context& c, int milliseconds) {
    for (int elapsed = 0; elapsed < milliseconds; elapsed += 10) { if (c.cancelled) return false; Sleep(10); }
    return sameForeground(c);
}
static bool keyChord(WORD key) {
    INPUT inputs[4]{};
    for (auto& input : inputs) input.type = INPUT_KEYBOARD;
    inputs[0].ki.wVk = VK_CONTROL; inputs[1].ki.wVk = key;
    inputs[2].ki.wVk = key; inputs[2].ki.dwFlags = KEYEVENTF_KEYUP;
    inputs[3].ki.wVk = VK_CONTROL; inputs[3].ki.dwFlags = KEYEVENTF_KEYUP;
    return SendInput(4, inputs, sizeof(INPUT)) == 4;
}
static HWND focusedControl(const Context& c) {
    GUITHREADINFO info{sizeof(GUITHREADINFO)};
    const DWORD thread = GetWindowThreadProcessId(c.released.root, nullptr);
    return GetGUIThreadInfo(thread, &info) ? info.hwndFocus : nullptr;
}
static bool pasteBody(Context& c, HWND owner) {
    if (!waitTarget(c, 220)) return false;
    const HWND focus = focusedControl(c);
    if (!focus) return false;
    if ((GetAsyncKeyState(VK_CONTROL) | GetAsyncKeyState(VK_MENU) | GetAsyncKeyState(VK_SHIFT)) & 0x8000) return false;
    bool opened = false;
    for (int i = 0; i < 8 && sameForeground(c); ++i) { if (OpenClipboard(owner)) { opened = true; break; } Sleep(15); }
    if (!opened) return false;
    const size_t bytes = (c.payload.text.size() + 1) * sizeof(wchar_t);
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
    bool written = false;
    if (memory) {
        auto ptr = GlobalLock(memory);
        if (ptr) {
            memcpy(ptr, c.payload.text.c_str(), bytes); GlobalUnlock(memory);
            if (sameForeground(c) && EmptyClipboard() && SetClipboardData(CF_UNICODETEXT, memory)) { written = true; memory = nullptr; }
        }
        if (memory) GlobalFree(memory);
    }
    CloseClipboard();
    if (!written) return false;
    const DWORD sequence = GetClipboardSequenceNumber();
    if (!sameForeground(c) || focusedControl(c) != focus || !keyChord(VK_HOME)) return false;
    if (!waitTarget(c, 40) || focusedControl(c) != focus || GetClipboardSequenceNumber() != sequence) return false;
    return keyChord('V');
}
static int selfTest() {
    auto state = std::make_shared<Context>(); auto& c = *state;
    c.payload.owner = 1; c.released.pid = 2;
    c.frozen = true; c.payload.text = L"[制作]\r\n中文"; c.payload.textFile = L"C:\\测试\\正文.txt"; c.payload.files = {L"C:\\测试\\视频.mp4", L"C:\\测试\\图片.png"};
    DataObject* data = new DataObject(state);
    FORMATETC file{CF_HDROP, nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL}, text{CF_UNICODETEXT, nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL};
    STGMEDIUM medium{};
    c.released.chat = true;
    if (data->QueryGetData(&text) != DV_E_FORMATETC || FAILED(data->GetData(&file, &medium))) return 1;
    auto drop = static_cast<DROPFILES*>(GlobalLock(medium.hGlobal));
    if (!drop->fWide || DragQueryFileW(static_cast<HDROP>(medium.hGlobal), 0xFFFFFFFF, nullptr, 0) != 2) return 2;
    GlobalUnlock(medium.hGlobal); ReleaseStgMedium(&medium);
    c.released.chat = false; c.released.shell = true;
    if (FAILED(data->GetData(&file, &medium))) return 3;
    if (DragQueryFileW(static_cast<HDROP>(medium.hGlobal), 0xFFFFFFFF, nullptr, 0) != 3) return 4;
    ReleaseStgMedium(&medium);
    c.payload.files.clear(); c.released.chat = true; c.released.shell = false;
    if (data->QueryGetData(&file) != DV_E_FORMATETC || FAILED(data->GetData(&text, &medium))) return 5;
    auto body = static_cast<wchar_t*>(GlobalLock(medium.hGlobal));
    const bool equal = c.payload.text == body; GlobalUnlock(medium.hGlobal); ReleaseStgMedium(&medium);
    if (!equal) return 6;
    c.released.pid = c.payload.owner;
    if (data->QueryGetData(&text) != DV_E_FORMATETC || data->QueryGetData(&file) != DV_E_FORMATETC) return 7;
    IEnumFORMATETC* formats = nullptr;
    if (FAILED(data->EnumFormatEtc(DATADIR_GET, &formats))) return 8;
    FORMATETC format{}; ULONG count = 0;
    const auto enumerated = formats->Next(1, &format, &count); formats->Release();
    if (enumerated != S_FALSE || count != 0) return 9;
    auto source = new DropSource(state);
    if (source->QueryContinueDrag(TRUE, MK_LBUTTON) != DRAGDROP_S_CANCEL) return 10;
    source->Release();
    c.released.pid = 2;
    std::weak_ptr<Context> lifetime = state;
    state.reset();
    if (lifetime.expired() || FAILED(data->GetData(&text, &medium))) return 11;
    ReleaseStgMedium(&medium); data->Release();
    if (!lifetime.expired()) return 12;
    return 0;
}
static napi_value stringValue(napi_env env, const char* text) {
    napi_value value; napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &value); return value;
}
static napi_value dragResult(napi_env env, bool dropped, bool chat, bool pasted, uint32_t queries) {
    napi_value result, value; napi_create_object(env, &result);
    napi_set_named_property(env, result, "status", stringValue(env, dropped ? "dropped" : "cancelled"));
    napi_set_named_property(env, result, "target", stringValue(env, chat ? "chat" : "files"));
    napi_get_boolean(env, pasted, &value); napi_set_named_property(env, result, "pasteInjected", value);
    napi_create_uint32(env, queries, &value); napi_set_named_property(env, result, "queryCount", value);
    return result;
}
static napi_value drag(napi_env env, napi_callback_info info) {
    size_t argc = 2, handleSize = 0, packetSize = 0; napi_value args[2]; void* handleBytes = nullptr; void* packet = nullptr;
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc != 2 || napi_get_buffer_info(env, args[0], &handleBytes, &handleSize) != napi_ok || handleSize != sizeof(HWND) ||
        napi_get_buffer_info(env, args[1], &packet, &packetSize) != napi_ok) {
        napi_throw_type_error(env, nullptr, "Expected native window handle and drag packet"); return nullptr;
    }
    HWND window; memcpy(&window, handleBytes, sizeof(window));
    DWORD pid = 0; const DWORD thread = GetWindowThreadProcessId(window, &pid);
    if (!IsWindow(window) || thread != GetCurrentThreadId() || pid != GetCurrentProcessId()) {
        napi_throw_error(env, nullptr, "Drag must run on the source window UI thread"); return nullptr;
    }
    auto state = std::make_shared<Context>(); auto& context = *state;
    context.sourceWindow = window;
    if (!readPayload(context.payload, packet, packetSize) || context.payload.owner != pid) {
        napi_throw_error(env, nullptr, "Invalid drag payload"); return nullptr;
    }
    if (GetAncestor(GetForegroundWindow(), GA_ROOT) != GetAncestor(window, GA_ROOT) || !(GetAsyncKeyState(VK_LBUTTON) & 0x8000))
        return dragResult(env, false, false, false, 0);
    if (FAILED(OleInitialize(nullptr))) { napi_throw_error(env, nullptr, "OLE initialization failed"); return nullptr; }
    // Everything inside the OLE loop is native. The calling renderer is waiting
    // synchronously, so no callbacks, IPC requests or JS timers may be required.
    ReleaseCapture();
    auto data = new DataObject(state); auto source = new DropSource(state);
    DWORD effect = DROPEFFECT_NONE;
    const HRESULT result = DoDragDrop(data, source, DROPEFFECT_COPY, &effect);
    const bool dropped = result == DRAGDROP_S_DROP && (effect & DROPEFFECT_COPY);
    context.cancelled = !dropped;
    context.frozen = true;
    bool pasted = false;
    if (dropped && context.released.chat && context.filesReadTarget == context.released.root && !context.payload.text.empty() && !context.payload.files.empty()) pasted = pasteBody(context, window);
    source->Release(); data->Release();
    OleUninitialize();
    if (FAILED(result)) { napi_throw_error(env, nullptr, "System drag operation failed"); return nullptr; }
    return dragResult(env, dropped, context.released.chat, pasted, context.queryCount);
}
static napi_value test(napi_env env, napi_callback_info) {
    napi_value value; napi_create_int32(env, selfTest(), &value); return value;
}
static napi_value init(napi_env env, napi_value exports) {
    napi_value function;
    napi_create_function(env, "drag", NAPI_AUTO_LENGTH, drag, nullptr, &function); napi_set_named_property(env, exports, "drag", function);
    napi_create_function(env, "selfTest", NAPI_AUTO_LENGTH, test, nullptr, &function); napi_set_named_property(env, exports, "selfTest", function);
    return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
