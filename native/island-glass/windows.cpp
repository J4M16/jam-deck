#include <windows.h>
#include <dwmapi.h>
#include <DispatcherQueue.h>
#include <windows.ui.composition.interop.h>
#include <winrt/Windows.System.h>
#include <winrt/Windows.UI.Composition.h>
#include <winrt/Windows.UI.Composition.Desktop.h>
#include <cstdio>
#include <cstdlib>
#include <thread>

using namespace winrt;
using namespace Windows::UI::Composition;
namespace {
constexpr UINT Command = WM_APP + 1;
HWND surface{}, island{};
bool enabled = false;
ContainerVisual root{nullptr};
SpriteVisual blur{nullptr};
CompositionRoundedRectangleGeometry geometry{nullptr};

// Read physical HWND bounds/DPI, not Electron's mixed-DPI desktop coordinates.
void sync() {
    if (!IsWindow(island)) { PostMessage(surface, WM_CLOSE, 0, 0); return; }
    RECT rect{};
    GetWindowRect(island, &rect);
    const float width = float(rect.right - rect.left), height = float(rect.bottom - rect.top);
    const float scale = GetDpiForWindow(island) / 96.0f;
    if (!enabled || !IsWindowVisible(island) || height <= 10.0f * scale) {
        ShowWindow(surface, SW_HIDE);
        return;
    }
    const float radius = 31.0f * scale;
    root.Size({width, height});
    geometry.Size({width, height + radius});
    geometry.CornerRadius({radius, radius});
    blur.Size({width, height + radius});
    blur.Offset({0, -radius, 0}); // flat screen-edge top; only bottom corners round
    SetWindowPos(surface, island, rect.left, rect.top, int(width), int(height),
        SWP_NOACTIVATE | SWP_SHOWWINDOW);
}

void CALLBACK changed(HWINEVENTHOOK, DWORD event, HWND window, LONG object, LONG, DWORD, DWORD) {
    if (window != island || object != OBJID_WINDOW) return;
    if (event == EVENT_OBJECT_DESTROY) PostMessage(surface, WM_CLOSE, 0, 0);
    else if (event == EVENT_OBJECT_LOCATIONCHANGE || event == EVENT_OBJECT_SHOW || event == EVENT_OBJECT_HIDE)
        sync();
}

LRESULT CALLBACK procedure(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    if (message == WM_NCHITTEST) return HTTRANSPARENT;
    if (message == WM_MOUSEACTIVATE) return MA_NOACTIVATE;
    if (message == Command) { enabled = wparam != 0; sync(); return 0; }
    if (message == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProc(window, message, wparam, lparam);
}
}

int main(int argc, char** argv) {
    try {
        if (argc != 2) return 2;
        island = reinterpret_cast<HWND>(std::strtoull(argv[1], nullptr, 10));
        if (!IsWindow(island)) return 2;
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        init_apartment(apartment_type::single_threaded);
        Windows::System::DispatcherQueueController queue{nullptr};
        DispatcherQueueOptions options{sizeof(DispatcherQueueOptions), DQTYPE_THREAD_CURRENT, DQTAT_COM_STA};
        check_hresult(CreateDispatcherQueueController(options,
            reinterpret_cast<ABI::Windows::System::IDispatcherQueueController**>(put_abi(queue))));
        WNDCLASS wc{};
        wc.hInstance = GetModuleHandle(nullptr);
        wc.lpfnWndProc = procedure;
        wc.lpszClassName = L"JamDeckIslandGlass";
        RegisterClass(&wc);
        surface = CreateWindowEx(WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW |
            WS_EX_TRANSPARENT | WS_EX_NOREDIRECTIONBITMAP, wc.lpszClassName,
            L"Jam Deck Glass Backdrop", WS_POPUP, 0, 0, 1, 1, nullptr, nullptr, wc.hInstance, nullptr);
        if (!surface) throw_last_error();
        BOOL hostBackdrop = TRUE;
        check_hresult(DwmSetWindowAttribute(surface, DWMWA_USE_HOSTBACKDROPBRUSH, &hostBackdrop, sizeof(hostBackdrop)));
        Compositor compositor;
        Windows::UI::Composition::Desktop::DesktopWindowTarget target{nullptr};
        auto interop = compositor.as<ABI::Windows::UI::Composition::Desktop::ICompositorDesktopInterop>();
        check_hresult(interop->CreateDesktopWindowTarget(surface, false,
            reinterpret_cast<ABI::Windows::UI::Composition::Desktop::IDesktopWindowTarget**>(put_abi(target))));
        root = compositor.CreateContainerVisual();
        target.Root(root);
        geometry = compositor.CreateRoundedRectangleGeometry();
        blur = compositor.CreateSpriteVisual();
        blur.Clip(compositor.CreateGeometricClip(geometry));
        blur.Brush(compositor.CreateHostBackdropBrush());
        root.Children().InsertAtBottom(blur);
        DWORD processId{};
        GetWindowThreadProcessId(island, &processId);
        auto hook = SetWinEventHook(EVENT_OBJECT_DESTROY, EVENT_OBJECT_LOCATIONCHANGE,
            nullptr, changed, processId, 0, WINEVENT_OUTOFCONTEXT);
        if (!hook) throw_last_error();
        // EOF closes the helper even if the plugin/renderer dies. No polling/capture loop.
        std::thread([] {
            char line[256];
            while (std::fgets(line, sizeof(line), stdin)) {
                if (line[0] == 'q') break;
                PostMessage(surface, Command, line[0] == 's', 0);
            }
            PostMessage(surface, WM_CLOSE, 0, 0);
        }).detach();
        std::puts("ready"); std::fflush(stdout);
        MSG message;
        while (GetMessage(&message, nullptr, 0, 0) > 0) {
            TranslateMessage(&message); DispatchMessage(&message);
        }
        UnhookWinEvent(hook);
        return 0;
    } catch (hresult_error const& error) {
        std::fprintf(stderr, "Windows glass error %lx: %ls\n", (unsigned long)error.code(), error.message().c_str());
        return 1;
    }
}
