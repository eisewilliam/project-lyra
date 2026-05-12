import AppKit
var count: UInt32 = 0
guard let methods = class_copyMethodList(NSWindow.self, &count) else { exit(1) }
for i in 0..<Int(count) {
    let sel = method_getName(methods[i])
    let name = String(cString: sel_getName(sel))
    if name.lowercased().contains("constrain") {
        print(name)
    }
}
