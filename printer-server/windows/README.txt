Maxwell Remote Printer Server for Windows (x64)

This agent lets any authenticated Maxwell Stock Manager device send label jobs over the internet. The Windows PC must stay powered on, connected to the internet, and connected to the ZPL printer. It creates an outbound HTTPS connection to Supabase; it does not expose a port or require router port forwarding.

SETUP
1. Extract this folder on the Windows PC connected to the ZPL label printer.
2. Add the printer in Windows Settings > Bluetooth & devices > Printers & scanners. Configure its driver/queue to accept raw ZPL. Set it as the Windows default, or choose it during first-run setup.
3. In Maxwell Stock Manager, sign in as an administrator. Open Team & access > Remote printer servers > Add printer server. Copy the one-time pairing token.
4. Double-click Start-Maxwell-Printer-Server.bat. On first run, enter:
   - Supabase project URL (Project Settings > API Keys / Connect)
   - Supabase publishable key (starts with sb_publishable_; never use a secret/service-role key)
   - The one-time pairing token
   - The installed printer number, or press Enter for the Windows default
5. Leave the server window open. It will show when it connects and when it sends a job. Other signed-in staff can now choose this printer server in the webpage and queue labels from phones or computers anywhere with internet access.

The pairing token is stored encrypted with Windows DPAPI for the current Windows account. To revoke it, use Disable beside the printer server in Team & access. To change the selected printer, remove %APPDATA%\Maxwell Printer Server\agent-config.bin and restart setup. This package needs no Python installation and supports 64-bit Windows 10/11.

Jobs submitted while the agent is offline remain queued until it reconnects. A Windows print-spooler success means the job was accepted by the queue; verify the printer has labels loaded and is configured for ZPL.
