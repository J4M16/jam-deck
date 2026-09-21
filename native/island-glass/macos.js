// JXA uses system AppKit directly: no Xcode, Python, permission prompt, or screen capture.
ObjC.import("Cocoa");

function run(argv) {
    const islandNumber = Number(argv[0]);
    if (!Number.isSafeInteger(islandNumber) || islandNumber <= 0) throw Error("Invalid island window number");
    const app = $.NSApplication.sharedApplication;
    app.setActivationPolicy($.NSApplicationActivationPolicyProhibited);
    const window = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
        $.NSMakeRect(0, 0, 1, 1), $.NSWindowStyleMaskBorderless, $.NSBackingStoreBuffered, false);
    window.opaque = false;
    window.backgroundColor = $.NSColor.clearColor;
    window.hasShadow = false;
    window.ignoresMouseEvents = true;
    window.level = $.NSFloatingWindowLevel;
    window.releasedWhenClosed = false;
    const effect = $.NSVisualEffectView.alloc.initWithFrame($.NSMakeRect(0, 0, 1, 1));
    effect.blendingMode = $.NSVisualEffectBlendingModeBehindWindow;
    effect.material = $.NSVisualEffectMaterialUnderWindowBackground;
    effect.state = $.NSVisualEffectStateActive;
    window.contentView = effect;
    let pending = "";
    const input = $.NSFileHandle.fileHandleWithStandardInput;
    function command(line) {
        if (line === "quit") { app.terminate(null); return; }
        if (line === "hide") { window.orderOut(null); return; }
        const parts = line.split(" ");
        if (parts[0] !== "show" || parts.length !== 6) return;
        const [x, y, width, height, radius] = parts.slice(1).map(Number);
        if (![x, y, width, height, radius].every(Number.isFinite) || width < 1 || height < 1) return;
        const primary = $.NSScreen.screens.objectAtIndex(0).frame;
        window.setFrameDisplay($.NSMakeRect(x, primary.size.height - y - height, width, height), false);
        effect.setFrameSize($.NSMakeSize(width, height));
        // AppKit coordinates start at the bottom: extend the top of the mask beyond the view.
        const mask = $.NSImage.alloc.initWithSize($.NSMakeSize(width, height));
        mask.lockFocus;
        $.NSColor.whiteColor.setFill;
        $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius(
            $.NSMakeRect(0, 0, width, height + radius), radius, radius).fill;
        mask.unlockFocus;
        effect.maskImage = mask;
        window.orderWindowRelativeTo($.NSWindowBelow, islandNumber);
    }
    ObjC.registerSubclass({
        name: "JamDeckGlassInput",
        methods: {
            "receive:": { types: ["void", ["id"]], implementation: function(notification) {
                const data = notification.userInfo.objectForKey($.NSFileHandleNotificationDataItem);
                if (Number(data.length) === 0) { app.terminate(null); return; }
                pending += ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
                const lines = pending.split("\n");
                pending = lines.pop();
                lines.forEach(command);
                input.readInBackgroundAndNotify;
            }}
        }
    });
    const observer = $.JamDeckGlassInput.alloc.init;
    $.NSNotificationCenter.defaultCenter.addObserverSelectorNameObject(
        observer, "receive:", $.NSFileHandleReadCompletionNotification, input);
    input.readInBackgroundAndNotify;
    $.NSFileHandle.fileHandleWithStandardOutput.writeData($("ready\n").dataUsingEncoding($.NSUTF8StringEncoding));
    app.run;
}
