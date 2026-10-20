#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <ole2.h>
#include <shlobj.h>
#include <shellapi.h>
#include <algorithm>
#include <atomic>
#include <cstdio>
#include <fcntl.h>
#include <io.h>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

struct Payload { uint32_t owner = 0; std::wstring text, textFile; std::vector<std::wstring> files; };
struct Target { HWND root = nullptr; DWORD pid = 0; bool chat = false, shell = false; };
struct Context {
    Payload payload;
    Target released;
    HWND notified = nullptr, filesReadTarget = nullptr;
    bool frozen = false;
    std::atomic_bool cancelled{false};
};
static bool readNumber(uint32_t& n) { return fread(&n, 4, 1, stdin) == 1; }
static bool readString(std::wstring& s) {
    uint32_t bytes;
    if (!readNumber(bytes) || bytes % 2 || bytes > 32 * 1024 * 1024) return false;
    s.resize(bytes / 2);
    return !bytes || fread(s.data(), 1, bytes, stdin) == bytes;
}
static bool readPayload(Payload& p) {
    char magic[4]; uint32_t count;
    if (fread(magic, 1, 4, stdin) != 4 || memcmp(magic, "JD01", 4)) return false;
    if (!readNumber(p.owner) || !readString(p.text) || !readString(p.textFile) || !readNumber(count) || count > 10000) return false;
    p.files.resize(count);
    for (auto& file : p.files) if (!readString(file)) return false;
    return !p.text.empty() || !p.files.empty();
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
    auto files = c.payload.files;
    // File destinations keep the body as a TXT. Chat receives editable text.
    if (!c.payload.text.empty() && target(c).shell && !c.payload.textFile.empty()) files.push_back(c.payload.textFile);
    return files;
}
static bool offersText(const Context& c) { return !c.payload.text.empty() && !(target(c).chat && !c.payload.files.empty()); }
static bool offersFiles(const Context& c) { return !offeredFiles(c).empty(); }

class DataObject final : public IDataObject {
    LONG refs = 1;
    Context& context;
public:
    explicit DataObject(Context& c) : context(c) {}
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

class DropSource final : public IDropSource, public IDropSourceNotify {
    LONG refs = 1;
    Context& context;
public:
    explicit DropSource(Context& c) : context(c) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** out) override {
        if (!out) return E_POINTER; *out = nullptr;
        if (iid == IID_IUnknown || iid == IID_IDropSource) *out = static_cast<IDropSource*>(this);
        else if (iid == IID_IDropSourceNotify) *out = static_cast<IDropSourceNotify*>(this);
        else return E_NOINTERFACE;
        AddRef(); return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refs); }
    ULONG STDMETHODCALLTYPE Release() override { const auto n = InterlockedDecrement(&refs); if (!n) delete this; return n; }
    HRESULT STDMETHODCALLTYPE QueryContinueDrag(BOOL escape, DWORD keys) override {
        if (escape || context.cancelled) return DRAGDROP_S_CANCEL;
        if (!(keys & MK_LBUTTON)) {
            context.released = targetAtCursor(); context.frozen = true;
            if (!context.released.root || context.released.pid == context.payload.owner) return DRAGDROP_S_CANCEL;
            return DRAGDROP_S_DROP;
        }
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GiveFeedback(DWORD) override { return DRAGDROP_S_USEDEFAULTCURSORS; }
    HRESULT STDMETHODCALLTYPE DragEnterTarget(HWND window) override { context.notified = window; return S_OK; }
    HRESULT STDMETHODCALLTYPE DragLeaveTarget() override { context.notified = nullptr; return S_OK; }
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
    Context c; c.frozen = true; c.payload.text = L"[制作]\r\n中文"; c.payload.textFile = L"C:\\测试\\正文.txt"; c.payload.files = {L"C:\\测试\\视频.mp4", L"C:\\测试\\图片.png"};
    DataObject* data = new DataObject(c);
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
    data->Release();
    if (!equal) return 6;
    std::cout << "{\"selfTest\":\"passed\"}\n"; return 0;
}
int main(int argc, char** argv) {
    _setmode(_fileno(stdin), _O_BINARY);
    if (FAILED(OleInitialize(nullptr))) { std::cout << "{\"status\":\"error\",\"reason\":\"OLE initialization failed\"}\n"; return 1; }
    if (argc == 2 && !strcmp(argv[1], "--self-test")) { const int result = selfTest(); OleUninitialize(); return result; }
    Context context;
    if (!readPayload(context.payload)) { std::cout << "{\"status\":\"error\",\"reason\":\"Invalid drag payload\"}\n"; OleUninitialize(); return 1; }
    // EOF from a closed Canvas / unloaded plugin cancels the drag and any delayed paste.
    std::thread([&context]() { while (fgetc(stdin) != EOF) {} context.cancelled = true; }).detach();
    if (!(GetAsyncKeyState(VK_LBUTTON) & 0x8000)) { std::cout << "{\"status\":\"cancelled\"}\n" << std::flush; ExitProcess(0); }
    HWND clipboardOwner = CreateWindowExW(0, L"STATIC", L"JamDeck drag clipboard", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, GetModuleHandle(nullptr), nullptr);
    auto data = new DataObject(context); auto source = new DropSource(context);
    DWORD effect = DROPEFFECT_NONE;
    const HRESULT result = DoDragDrop(data, source, DROPEFFECT_COPY, &effect);
    const bool dropped = result == DRAGDROP_S_DROP && (effect & DROPEFFECT_COPY);
    bool pasted = false;
    if (dropped && context.released.chat && context.filesReadTarget == context.released.root && !context.payload.text.empty() && !context.payload.files.empty()) pasted = pasteBody(context, clipboardOwner);
    source->Release(); data->Release(); DestroyWindow(clipboardOwner);
    std::cout << "{\"status\":\"" << (dropped ? "dropped" : "cancelled") << "\",\"target\":\"" << (context.released.chat ? "chat" : "files") << "\",\"pasteInjected\":" << (pasted ? "true" : "false") << "}\n" << std::flush;
    OleUninitialize();
    // The stdin watcher is process-scoped; do not destroy its referenced Context.
    ExitProcess(0);
}
