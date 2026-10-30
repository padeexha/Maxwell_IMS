Maxwell Printer Server for Windows (x64)

1. Extract this folder to a location you can keep, such as Documents\Maxwell Printer Server.
2. Add and configure your thermal label printer in Windows Settings > Bluetooth & devices > Printers & scanners.
   The printer must accept raw ZPL. Select a ZPL-compatible driver or configure the printer for ZPL/RAW output.
3. Double-click Start-Maxwell-Printer-Server.bat. Keep the black window open while using Maxwell Stock Manager.
   The bridge listens only on this PC at http://127.0.0.1:5001. Press Ctrl+C to stop it.
4. Open Maxwell Stock Manager and print labels. The first configured/default Windows printer is used unless the app supplies a printer name.

The server does not require Python to be installed. This package is for 64-bit Windows 10/11.
If Windows Firewall asks, allow access only on Private networks; the server binds to this PC's loopback address.
