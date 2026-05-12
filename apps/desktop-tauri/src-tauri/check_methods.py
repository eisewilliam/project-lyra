from Cocoa import NSWindow
methods = [m for m in dir(NSWindow) if 'constrain' in m.lower()]
print(methods)
from AppKit import NSPanel
methods = [m for m in dir(NSPanel) if 'constrain' in m.lower()]
print(methods)
