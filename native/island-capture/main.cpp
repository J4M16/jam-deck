#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wincodec.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <fcntl.h>
#include <io.h>
#include <iostream>
#include <mutex>
#include <memory>
#include <sstream>
#include <thread>
#include <vector>

using namespace winrt;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
using namespace winrt::Windows::Graphics::DirectX::Direct3D11;
using ::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess;

// WGC excludes the protected island and explicitly disables cursor composition.
// Only the island rectangle crosses the GPU/CPU boundary; stdout is JPEG packets.
class Capture {
    HWND island;
    HMONITOR monitor;
    com_ptr<ID3D11Device> device;
    com_ptr<ID3D11DeviceContext> context;
    IDirect3DDevice runtime{nullptr};
    com_ptr<IWICImagingFactory> wic;
    Direct3D11CaptureFramePool pool{nullptr};
    GraphicsCaptureSession session{nullptr};
    com_ptr<ID3D11Texture2D> staging;
    int outputWidth = 0, outputHeight = 0;
public:
    explicit Capture(HWND target) : island(target), monitor(MonitorFromWindow(target, MONITOR_DEFAULTTONEAREST)) {
        check_hresult(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION,
            device.put(), nullptr, context.put()));
        com_ptr<IInspectable> inspectable;
        check_hresult(CreateDirect3D11DeviceFromDXGIDevice(device.as<IDXGIDevice>().get(), inspectable.put()));
        runtime = inspectable.as<IDirect3DDevice>();
        check_hresult(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
            guid_of<IWICImagingFactory>(), wic.put_void()));
    }
    void hide() {
        if (session) { session.Close(); session = nullptr; }
        if (pool) { pool.Close(); pool = nullptr; }
        staging = nullptr;
    }
    void show(int width, int height) {
        hide();
        outputWidth = width; outputHeight = height;
        auto factory = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
        GraphicsCaptureItem item{nullptr};
        check_hresult(factory->CreateForMonitor(monitor, guid_of<GraphicsCaptureItem>(), put_abi(item)));
        pool = Direct3D11CaptureFramePool::CreateFreeThreaded(runtime, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, item.Size());
        session = pool.CreateCaptureSession(item);
        session.IsCursorCaptureEnabled(false);
        session.IsBorderRequired(false);
        session.StartCapture();
    }
    void paint() {
        auto frame = pool.TryGetNextFrame();
        if (!frame) return;
        auto texture = frame.Surface().as<IDirect3DDxgiInterfaceAccess>();
        com_ptr<ID3D11Texture2D> source;
        check_hresult(texture->GetInterface(guid_of<ID3D11Texture2D>(), source.put_void()));
        D3D11_TEXTURE2D_DESC desc{}; source->GetDesc(&desc);
        MONITORINFO info{sizeof(info)}; RECT rect{};
        if (!GetMonitorInfoW(monitor, &info) || !GetWindowRect(island, &rect)) throw hresult_error(E_FAIL, L"Capture target disappeared");
        const UINT left = std::clamp<LONG>(rect.left - info.rcMonitor.left, 0, desc.Width);
        const UINT top = std::clamp<LONG>(rect.top - info.rcMonitor.top, 0, desc.Height);
        const UINT width = std::min<UINT>(std::max<LONG>(1, rect.right - rect.left), desc.Width - left);
        const UINT height = std::min<UINT>(std::max<LONG>(1, rect.bottom - rect.top), desc.Height - top);
        if (!width || !height) return;
        D3D11_TEXTURE2D_DESC old{}; if (staging) staging->GetDesc(&old);
        if (!staging || old.Width != width || old.Height != height) {
            staging = nullptr;
            desc.Width = width; desc.Height = height; desc.MipLevels = 1; desc.ArraySize = 1;
            desc.SampleDesc = {1, 0}; desc.Usage = D3D11_USAGE_STAGING;
            desc.BindFlags = 0; desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ; desc.MiscFlags = 0;
            check_hresult(device->CreateTexture2D(&desc, nullptr, staging.put()));
        }
        D3D11_BOX box{left, top, 0, left + width, top + height, 1};
        context->CopySubresourceRegion(staging.get(), 0, 0, 0, 0, source.get(), 0, &box);
        D3D11_MAPPED_SUBRESOURCE pixels{};
        check_hresult(context->Map(staging.get(), 0, D3D11_MAP_READ, 0, &pixels));
        com_ptr<IWICBitmap> bitmap;
        const HRESULT copied = wic->CreateBitmapFromMemory(width, height, GUID_WICPixelFormat32bppBGRA,
            pixels.RowPitch, pixels.RowPitch * height, static_cast<BYTE*>(pixels.pData), bitmap.put());
        context->Unmap(staging.get(), 0);
        check_hresult(copied);
        frame.Close();
        com_ptr<IWICBitmapScaler> scaler; check_hresult(wic->CreateBitmapScaler(scaler.put()));
        check_hresult(scaler->Initialize(bitmap.get(), outputWidth, outputHeight, WICBitmapInterpolationModeLinear));
        com_ptr<IWICFormatConverter> rgb; check_hresult(wic->CreateFormatConverter(rgb.put()));
        check_hresult(rgb->Initialize(scaler.get(), GUID_WICPixelFormat24bppBGR, WICBitmapDitherTypeNone, nullptr, 0, WICBitmapPaletteTypeCustom));
        com_ptr<IStream> bytes; check_hresult(CreateStreamOnHGlobal(nullptr, TRUE, bytes.put()));
        com_ptr<IWICBitmapEncoder> encoder; check_hresult(wic->CreateEncoder(GUID_ContainerFormatJpeg, nullptr, encoder.put()));
        check_hresult(encoder->Initialize(bytes.get(), WICBitmapEncoderNoCache));
        com_ptr<IWICBitmapFrameEncode> encoded; com_ptr<IPropertyBag2> options;
        check_hresult(encoder->CreateNewFrame(encoded.put(), options.put()));
        PROPBAG2 quality{}; quality.pstrName = const_cast<wchar_t*>(L"ImageQuality");
        VARIANT value{}; value.vt = VT_R4; value.fltVal = .88f;
        check_hresult(options->Write(1, &quality, &value));
        check_hresult(encoded->Initialize(options.get()));
        check_hresult(encoded->SetSize(outputWidth, outputHeight));
        auto format = GUID_WICPixelFormat24bppBGR; check_hresult(encoded->SetPixelFormat(&format));
        check_hresult(encoded->WriteSource(rgb.get(), nullptr));
        check_hresult(encoded->Commit()); check_hresult(encoder->Commit());
        STATSTG stats{}; check_hresult(bytes->Stat(&stats, STATFLAG_NONAME));
        const uint32_t length = stats.cbSize.LowPart;
        HGLOBAL handle{}; check_hresult(GetHGlobalFromStream(bytes.get(), &handle));
        const auto data = static_cast<const char*>(GlobalLock(handle));
        const char header[]{char(length >> 24), char(length >> 16), char(length >> 8), char(length)};
        std::cout.write(header, 4).write(data, length).flush();
        GlobalUnlock(handle);
        if (!std::cout) throw hresult_error(E_FAIL, L"Capture pipe closed");
    }
    ~Capture() { hide(); }
};

int main(int argc, char** argv) {
    try {
        if (argc != 2) throw hresult_error(E_INVALIDARG);
        // A console process may already have its process DPI context fixed by Windows.
        // Pin this capture thread so HWND/monitor coordinates match WGC physical pixels.
        if (!SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) throw hresult_error(HRESULT_FROM_WIN32(GetLastError()));
        init_apartment(apartment_type::multi_threaded);
        _setmode(_fileno(stdout), _O_BINARY);
        const auto island = reinterpret_cast<HWND>(std::stoull(argv[1]));
        if (!IsWindow(island) || !GraphicsCaptureSession::IsSupported()) throw hresult_error(E_INVALIDARG);
        Capture capture(island);
        struct Commands { std::mutex mutex; std::condition_variable changed; std::deque<std::string> lines; };
        const auto pending = std::make_shared<Commands>();
        // stdin EOF also shuts the helper down if the parent exits unexpectedly.
        std::thread([pending] {
            std::string line;
            while (std::getline(std::cin, line)) {
                { std::lock_guard lock(pending->mutex); pending->lines.push_back(line); }
                pending->changed.notify_one();
                if (line == "quit") return;
            }
            { std::lock_guard lock(pending->mutex); pending->lines.push_back("quit"); }
            pending->changed.notify_one();
        }).detach();
        std::cout.write("ready\n", 6).flush();
        bool visible = false;
        for (;;) {
            const auto next = std::chrono::steady_clock::now() + std::chrono::milliseconds(34);
            std::deque<std::string> incoming;
            {
                std::unique_lock lock(pending->mutex);
                if (pending->lines.empty() && !visible) pending->changed.wait(lock, [&] { return !pending->lines.empty(); });
                incoming.swap(pending->lines);
            }
            for (auto& command : incoming) {
                if (command == "quit") return 0;
                if (command == "hide") { capture.hide(); visible = false; continue; }
                std::istringstream fields(command); std::string action; double x, y; int width, height;
                if (fields >> action >> x >> y >> width >> height && action == "show" && width > 0 && height > 0) {
                    capture.show(width, height); visible = true;
                }
            }
            if (visible) {
                capture.paint();
                std::unique_lock lock(pending->mutex);
                pending->changed.wait_until(lock, next, [&] { return !pending->lines.empty(); });
            }
        }
    } catch (const hresult_error& error) {
        std::cerr << "Windows desktop capture failed: " << to_string(error.message()) << " (" << std::hex << error.code().value << ")\n";
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; }
    return 1;
}
