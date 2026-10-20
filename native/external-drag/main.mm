#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <node_api.h>
#include <cstring>

// Node-API is loaded in Electron's main process. All AppKit work stays on main.
static NSMutableDictionary<NSNumber*, id>* sessions;
static uint32_t nextId = 0;
static NSString* stringProperty(napi_env env, napi_value object, const char* key) {
    napi_value value; size_t length = 0;
    if (napi_get_named_property(env, object, key, &value) != napi_ok ||
        napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return @"";
    NSMutableData* bytes = [NSMutableData dataWithLength:length + 1];
    napi_get_value_string_utf8(env, value, (char*)bytes.mutableBytes, length + 1, &length);
    return [[NSString alloc] initWithBytes:bytes.bytes length:length encoding:NSUTF8StringEncoding] ?: @"";
}
static NSDictionary* targetAtPoint(NSPoint point) {
    NSArray* windows = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
    const CGFloat mainHeight = CGDisplayBounds(CGMainDisplayID()).size.height;
    CGPoint cgPoint = CGPointMake(point.x, mainHeight - point.y);
    for (NSDictionary* info in windows) {
        if ([info[(id)kCGWindowLayer] intValue] != 0 || [info[(id)kCGWindowOwnerPID] intValue] == getpid()) continue;
        CGRect rect; if (!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)info[(id)kCGWindowBounds], &rect) || !CGRectContainsPoint(rect, cgPoint)) continue;
        NSRunningApplication* app = [NSRunningApplication runningApplicationWithProcessIdentifier:[info[(id)kCGWindowOwnerPID] intValue]];
        NSString* bundle = app.bundleIdentifier.lowercaseString ?: @"";
        BOOL chat = [bundle isEqualToString:@"com.tencent.xinwechat"] || [bundle isEqualToString:@"com.tencent.weworkmac"];
        return @{@"pid":info[(id)kCGWindowOwnerPID], @"window":info[(id)kCGWindowNumber], @"chat":@(chat)};
    }
    return @{};
}
static BOOL frontIsTarget(NSDictionary* target) {
    pid_t pid = [target[@"pid"] intValue];
    if (!pid || NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != pid) return NO;
    NSArray* windows = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
    for (NSDictionary* info in windows) {
        if ([info[(id)kCGWindowLayer] intValue] != 0 || [info[(id)kCGWindowOwnerPID] intValue] != pid) continue;
        return [info[(id)kCGWindowNumber] isEqual:target[@"window"]];
    }
    return NO;
}
static id focusedEditor(NSDictionary* target) {
    AXUIElementRef app = AXUIElementCreateApplication([target[@"pid"] intValue]);
    CFTypeRef focused = nullptr, role = nullptr;
    BOOL editable = NO;
    if (AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute, &focused) == kAXErrorSuccess) {
        if (AXUIElementCopyAttributeValue((AXUIElementRef)focused, kAXRoleAttribute, &role) == kAXErrorSuccess) {
            editable = CFEqual(role, kAXTextAreaRole) || CFEqual(role, kAXTextFieldRole) || CFEqual(role, kAXComboBoxRole);
            CFRelease(role);
        }
    }
    CFRelease(app);
    id element = CFBridgingRelease(focused);
    return editable ? element : nil;
}
static BOOL sameEditor(NSDictionary* target, id element) {
    id current = focusedEditor(target);
    return current && element && CFEqual((__bridge CFTypeRef)current, (__bridge CFTypeRef)element);
}
static void commandKey(CGKeyCode key) {
    CGEventRef down = CGEventCreateKeyboardEvent(nullptr, key, true);
    CGEventRef up = CGEventCreateKeyboardEvent(nullptr, key, false);
    CGEventSetFlags(down, kCGEventFlagMaskCommand); CGEventSetFlags(up, kCGEventFlagMaskCommand);
    CGEventPost(kCGHIDEventTap, down); CGEventPost(kCGHIDEventTap, up);
    CFRelease(down); CFRelease(up);
}

@interface JDTextPromise : NSFilePromiseProvider<NSFilePromiseProviderDelegate>
@property(nonatomic, copy) NSString* plainText;
@property(nonatomic, copy) NSString* filename;
@property(nonatomic) BOOL includeString;
@end
@implementation JDTextPromise
- (NSString*)filePromiseProvider:(NSFilePromiseProvider*)provider fileNameForType:(NSString*)type { return self.filename ?: @"正文.txt"; }
- (NSOperationQueue*)operationQueueForFilePromiseProvider:(NSFilePromiseProvider*)provider { return NSOperationQueue.mainQueue; }
- (void)filePromiseProvider:(NSFilePromiseProvider*)provider writePromiseToURL:(NSURL*)url completionHandler:(void (^)(NSError*))completionHandler {
    NSError* error = nil;
    [[@"\uFEFF" stringByAppendingString:self.plainText] writeToURL:url atomically:YES encoding:NSUTF8StringEncoding error:&error];
    completionHandler(error);
}
- (NSArray<NSPasteboardType>*)writableTypesForPasteboard:(NSPasteboard*)pasteboard {
    NSArray* types = [super writableTypesForPasteboard:pasteboard];
    return self.includeString ? [types arrayByAddingObject:NSPasteboardTypeString] : types;
}
- (id)pasteboardPropertyListForType:(NSPasteboardType)type {
    if ([type isEqualToString:NSPasteboardTypeString]) return self.plainText;
    return [super pasteboardPropertyListForType:type];
}
@end

@interface JDDrag : NSObject<NSDraggingSource>
@property(nonatomic) uint32_t identifier;
@property(nonatomic, copy) NSString* text;
@property(nonatomic, copy) NSString* textFile;
@property(nonatomic) BOOL mixed, cancelled, ended;
@property(nonatomic, strong) NSDictionary* result;
@property(nonatomic, strong) NSArray* retainedItems;
@end
@implementation JDDrag
- (NSDragOperation)draggingSession:(NSDraggingSession*)session sourceOperationMaskForDraggingContext:(NSDraggingContext)context { return context == NSDraggingContextWithinApplication ? NSDragOperationNone : NSDragOperationCopy; }
- (BOOL)ignoreModifierKeysForDraggingSession:(NSDraggingSession*)session { return YES; }
- (void)draggingSession:(NSDraggingSession*)session endedAtPoint:(NSPoint)point operation:(NSDragOperation)operation {
    self.ended = YES;
    if (self.cancelled || operation == NSDragOperationNone) {
        self.result = @{@"status":@"cancelled"};
        if (self.cancelled) [sessions removeObjectForKey:@(self.identifier)];
        return;
    }
    NSDictionary* target = targetAtPoint(point);
    BOOL chat = [target[@"chat"] boolValue];
    self.result = @{@"status":@"dropped", @"target":chat ? @"chat" : @"files", @"pasteInjected":@NO};
    if (!self.mixed || !chat) return;
    self.result = nil;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 220 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        if (self.cancelled) return;
        self.result = @{@"status":@"dropped", @"target":@"chat", @"pasteInjected":@NO};
        if (!AXIsProcessTrusted() || !frontIsTarget(target)) return;
        id editor = focusedEditor(target);
        if (!editor) return;
        NSPasteboard* board = NSPasteboard.generalPasteboard;
        [board clearContents];
        if (![board setString:self.text forType:NSPasteboardTypeString]) return;
        NSInteger change = board.changeCount;
        if (!frontIsTarget(target) || !sameEditor(target, editor)) return;
        commandKey(126); // Command + Up: beginning of the editing surface.
        self.result = nil;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 40 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
            if (self.cancelled) return;
            BOOL paste = frontIsTarget(target) && sameEditor(target, editor) && board.changeCount == change;
            if (paste) commandKey(9); // V
            self.result = @{@"status":@"dropped", @"target":@"chat", @"pasteInjected":@(paste)};
        });
    });
}
@end

static napi_value begin(napi_env env, napi_callback_info info) {
    size_t count = 2; napi_value args[2]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    if (count != 2 || !NSThread.isMainThread || !(NSEvent.pressedMouseButtons & 1)) {
        napi_throw_error(env, nullptr, "Drag must start on the main thread while the mouse is pressed"); return nullptr;
    }
    void* bytes = nullptr; size_t length = 0; uintptr_t raw = 0;
    if (napi_get_buffer_info(env, args[0], &bytes, &length) != napi_ok || length < sizeof(raw)) {
        napi_throw_error(env, nullptr, "Invalid source window"); return nullptr;
    }
    memcpy(&raw, bytes, sizeof(raw));
    NSView* view = nil;
    for (NSWindow* window in NSApp.windows) if ((uintptr_t)(__bridge void*)window.contentView == raw) { view = window.contentView; break; }
    if (!view.window) { napi_throw_error(env, nullptr, "Source window is closed"); return nullptr; }
    if (!sessions) sessions = [NSMutableDictionary new];
    for (JDDrag* old in sessions.allValues) if (!old.ended) { napi_throw_error(env, nullptr, "Another drag is active"); return nullptr; }
    JDDrag* source = [JDDrag new];
    source.identifier = ++nextId; source.text = stringProperty(env, args[1], "text"); source.textFile = stringProperty(env, args[1], "textFile");
    napi_value fileValues; uint32_t fileCount = 0;
    napi_get_named_property(env, args[1], "files", &fileValues); napi_get_array_length(env, fileValues, &fileCount);
    NSMutableArray* writers = [NSMutableArray new];
    for (uint32_t index = 0; index < fileCount; ++index) {
        napi_value value, wrapper; napi_get_element(env, fileValues, index, &value);
        napi_create_object(env, &wrapper); napi_set_named_property(env, wrapper, "file", value);
        NSString* path = stringProperty(env, wrapper, "file");
        if (path.length) [writers addObject:[NSURL fileURLWithPath:path]];
    }
    source.mixed = source.text.length && writers.count;
    if (source.text.length) {
        JDTextPromise* promise = [JDTextPromise new];
        promise.fileType = @"public.utf8-plain-text";
        promise.delegate = promise; // The provider owns its data; the delegate must outlive polling.
        promise.plainText = source.text; promise.filename = source.textFile.lastPathComponent; promise.includeString = !source.mixed;
        [writers addObject:promise];
    }
    if (!writers.count) { napi_throw_error(env, nullptr, "Empty drag"); return nullptr; }
    NSPoint location = view.window.mouseLocationOutsideOfEventStream;
    NSPoint local = [view convertPoint:location fromView:nil];
    NSMutableArray<NSDraggingItem*>* items = [NSMutableArray new];
    NSImage* image = [NSImage imageWithSystemSymbolName:@"doc.on.doc" accessibilityDescription:@"拖出"];
    for (id<NSPasteboardWriting> writer in writers) {
        NSDraggingItem* item = [[NSDraggingItem alloc] initWithPasteboardWriter:writer];
        [item setDraggingFrame:NSMakeRect(local.x, local.y, 32, 32) contents:image];
        [items addObject:item];
    }
    source.retainedItems = writers; sessions[@(source.identifier)] = source;
    NSEvent* event = [NSEvent mouseEventWithType:NSEventTypeLeftMouseDragged location:location modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:view.window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1];
    NSDraggingSession* session = nil;
    @try {
        if (event) session = [view beginDraggingSessionWithItems:items event:event source:source];
    } @catch (NSException* exception) {
        [sessions removeObjectForKey:@(source.identifier)];
        napi_throw_error(env, nullptr, exception.reason.UTF8String); return nullptr;
    }
    if (!session) {
        [sessions removeObjectForKey:@(source.identifier)];
        napi_throw_error(env, nullptr, "Unable to start the native drag"); return nullptr;
    }
    session.animatesToStartingPositionsOnCancelOrFail = YES;
    napi_value result; napi_create_uint32(env, source.identifier, &result); return result;
}
static napi_value poll(napi_env env, napi_callback_info info) {
    size_t count = 1; napi_value arg; uint32_t identifier = 0;
    napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr); napi_get_value_uint32(env, arg, &identifier);
    JDDrag* source = sessions[@(identifier)];
    napi_value value; napi_get_null(env, &value);
    if (!source.result) return value;
    napi_create_object(env, &value);
    for (NSString* key in source.result) {
        napi_value property; id item = source.result[key];
        if ([item isKindOfClass:NSString.class]) napi_create_string_utf8(env, [item UTF8String], NAPI_AUTO_LENGTH, &property);
        else napi_get_boolean(env, [item boolValue], &property);
        napi_set_named_property(env, value, key.UTF8String, property);
    }
    // File promises can finish after drop. AppKit retains the promise/provider as needed.
    [sessions removeObjectForKey:@(identifier)]; return value;
}
static napi_value cancel(napi_env env, napi_callback_info info) {
    size_t count = 1; napi_value arg; uint32_t identifier = 0;
    napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr); napi_get_value_uint32(env, arg, &identifier);
    JDDrag* source = sessions[@(identifier)]; source.cancelled = YES;
    if (source.ended) [sessions removeObjectForKey:@(identifier)];
    napi_value result; napi_get_undefined(env, &result); return result;
}
static napi_value initialize(napi_env env, napi_value exports) {
    napi_property_descriptor properties[] = {
        {"begin", nullptr, begin, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"poll", nullptr, poll, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"cancel", nullptr, cancel, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, 3, properties); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
