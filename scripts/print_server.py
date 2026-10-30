#!/usr/bin/env python3
import http.server
import json
import subprocess
import os
import qrcode
from PIL import Image, ImageDraw, ImageFont

PORT = 5001
DEFAULT_ALLOWED_ORIGINS = (
    "http://127.0.0.1:5173,http://localhost:5173,"
    "http://127.0.0.1:5174,http://localhost:5174,"
    "http://127.0.0.1:4173,http://localhost:4173,"
    "https://maxwell-ims.vercel.app"
)
MAX_REQUEST_BYTES = 1_000_000

# ── Dimensions matching Barcode Gen.py ────────────────────────────────────────
LABEL_W     = 400  # 50mm sticker = 400 dots
LABEL_GAP   = 24   # 3mm inter-sticker gap = 24 dots
LEFT_MARGIN = 0

_BOLD_FONT_PATHS = [
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial Bold.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\arial.ttf",
    # Ubuntu font paths
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
]

def name_to_gfa(text: str, height: int, col_width: int,
                min_height: int = 12, align: str = "center") -> tuple:
    """Render text as a solid filled bitmap.
    Shrinks font to fit on one line; if still too small, wraps to two lines.
    """
    def _load(size):
        for path in _BOLD_FONT_PATHS:
            if os.path.exists(path):
                try:
                    return ImageFont.truetype(path, size)
                except Exception:
                    continue
        print("WARNING: Using tiny fallback default font! Install system fonts for best layout: 'sudo apt install fonts-liberation'")
        return ImageFont.load_default()

    def _measure(fnt, t):
        try:
            b = fnt.getbbox(t)
            return b[2] - b[0], b[3] - b[1], b[0], b[1]
        except AttributeError:
            w, h = fnt.getsize(t)
            return w, h, 0, 0

    def _fits(fnt, t):
        return _measure(fnt, t)[0] <= col_width - 20

    def _best_wrap(fnt, t):
        words = t.split()
        best, best_diff = None, float("inf")
        for i in range(1, len(words)):
            l1, l2 = " ".join(words[:i]), " ".join(words[i:])
            if _fits(fnt, l1) and _fits(fnt, l2):
                diff = abs(_measure(fnt, l1)[0] - _measure(fnt, l2)[0])
                if diff < best_diff:
                    best, best_diff = (l1, l2), diff
                return best
        return best

    MIN_SINGLE = 22

    size = height
    fnt  = _load(size)
    while size > MIN_SINGLE and not _fits(fnt, text):
        size -= 1
        fnt = _load(size)

    if _fits(fnt, text):
        render_lines = [text]
    else:
        size = height
        fnt  = _load(size)
        wrapped = None
        while size >= min_height:
            wrapped = _best_wrap(fnt, text)
            if wrapped:
                break
            size -= 1
            fnt = _load(size)
        render_lines = list(wrapped) if wrapped else [text]

    line_gap = 3
    sample_h  = _measure(fnt, "Ag")[1]
    img_h = sample_h * len(render_lines) + line_gap * (len(render_lines) - 1) + 12
    img   = Image.new("L", (col_width, img_h), 0)
    draw  = ImageDraw.Draw(img)

    for idx, line in enumerate(render_lines):
        tw, _, bx, by = _measure(fnt, line)
        tx = (max(0, (col_width - tw) // 2) - bx) if align == "center" else -bx
        ty = 6 + idx * (sample_h + line_gap) - by
        draw.text((tx, ty), line, fill=255, font=fnt)

    bpr      = (col_width + 7) // 8
    hex_rows = []
    for row_y in range(img_h):
        bits = [1 if img.getpixel((x, row_y)) > 127 else 0 for x in range(col_width)]
        while len(bits) % 8:
            bits.append(0)
        hex_rows.append(''.join(
            f'{int("".join(map(str, bits[i:i+8])), 2):02X}'
            for i in range(0, len(bits), 8)
        ))

    return ''.join(hex_rows), bpr, bpr * img_h, col_width, img_h

def qr_to_gfa(data: str, scale: int = 4) -> tuple:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=1)
    qr.add_data(data)
    qr.make(fit=True)
    matrix = qr.get_matrix()
    size   = len(matrix)
    width  = size * scale
    height = size * scale
    bpr    = (width + 7) // 8

    hex_rows = []
    for row in matrix:
        bits = []
        for cell in row:
            bits.extend([1 if cell else 0] * scale)
        while len(bits) % 8:
            bits.append(0)
        row_hex = ''.join(
            f'{int("".join(map(str, bits[i:i+8])), 2):02X}'
            for i in range(0, len(bits), 8)
        )
        for _ in range(scale):
            hex_rows.append(row_hex)

    return ''.join(hex_rows), bpr, bpr * height, width, height

def build_zpl_from_labels(labels: list[dict]) -> str:
    """
    Build 2-up ZPL for a list of label structures.
    Lays out labels side-by-side in pairs.
    """
    pairs = [labels[i:i+2] for i in range(0, len(labels), 2)]
    zpl_blocks = []

    for pair in pairs:
        # Pad pair to exactly 2 items for 2-up columns
        pair_list = list(pair)
        while len(pair_list) < 2:
            pair_list.append({"name": "", "barcode": ""})

        lines = [
            "^XA",
            "^PW880",
            "^LL200",
            "^LH0,0",
            "^CI28",
        ]

        for col, label in enumerate(pair_list):
            name    = label.get("name", "").strip()
            barcode = label.get("barcode", "").strip()

            if not barcode:
                continue

            x_base = LEFT_MARGIN + col * (LABEL_W + LABEL_GAP)

            # 1. QR Code
            hex_data, bpr, total, qr_w, qr_h = qr_to_gfa(barcode, scale=4)
            qr_x = x_base + (LABEL_W - qr_w) // 2
            qr_y = 5
            lines += [
                f"^FO{qr_x},{qr_y}",
                f"^GFA,{total},{total},{bpr},{hex_data}",
            ]

            # 2. Product Name
            name_y      = qr_y + qr_h + 10
            avail_y     = 195 - name_y
            code_h_est  = 30
            name_max_h  = avail_y - code_h_est - 4
            max_font    = max(10, min(20, name_max_h - 12))

            hex_n, bpr_n, tot_n, _, h_n = name_to_gfa(name, max_font, LABEL_W - 10, align="center")
            lines += [
                f"^FO{x_base + 5},{name_y}",
                f"^GFA,{tot_n},{tot_n},{bpr_n},{hex_n}",
            ]

            # 3. Product Code
            hex_c, bpr_c, tot_c, *_ = name_to_gfa(barcode, 18, LABEL_W - 10, align="center")
            lines += [
                f"^FO{x_base + 5},{name_y + h_n + 4}",
                f"^GFA,{tot_c},{tot_c},{bpr_c},{hex_c}",
            ]

        lines.append("^XZ")
        zpl_blocks.append("\n".join(lines))

    return "\n".join(zpl_blocks)


def validate_labels(labels):
    if not isinstance(labels, list) or not labels or len(labels) > 100:
        raise ValueError("Provide between 1 and 100 labels")
    for label in labels:
        if not isinstance(label, dict):
            raise ValueError("Each label must be an object")
        name = label.get("name", "")
        code = label.get("barcode", "")
        if not isinstance(name, str) or len(name) > 200:
            raise ValueError("Label names must be text up to 200 characters")
        if not isinstance(code, str) or not code.strip() or len(code) > 200:
            raise ValueError("Label codes must be text between 1 and 200 characters")


def get_installed_printers():
    """Return installed printers on Windows or macOS/Linux CUPS systems."""
    if os.name == "nt":
        import win32print
        flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
        return [entry[2] for entry in win32print.EnumPrinters(flags)]
    result = subprocess.run(["lpstat", "-p"], capture_output=True, text=True, timeout=5)
    return [line.split()[1] for line in result.stdout.splitlines()
            if line.startswith("printer ") and len(line.split()) > 1]


def get_default_printer():
    if os.name == "nt":
        import win32print
        return win32print.GetDefaultPrinter()
    result = subprocess.run(["lpstat", "-d"], capture_output=True, text=True, timeout=5)
    prefix = "system default destination:"
    return result.stdout.split(prefix, 1)[1].strip() if prefix in result.stdout else ""


def send_raw_to_printer(printer, zpl):
    """Send raw ZPL bytes through the platform's native print spooler."""
    if os.name == "nt":
        import win32print
        handle = win32print.OpenPrinter(printer)
        job = None
        page_started = False
        try:
            job = win32print.StartDocPrinter(handle, 1, ("Maxwell Inventory Labels", None, "RAW"))
            win32print.StartPagePrinter(handle)
            page_started = True
            win32print.WritePrinter(handle, zpl.encode("utf-8"))
        finally:
            if page_started:
                win32print.EndPagePrinter(handle)
            if job is not None:
                win32print.EndDocPrinter(handle)
            win32print.ClosePrinter(handle)
        return
    subprocess.run(["cupsenable", printer], capture_output=True, timeout=5)
    proc = subprocess.run(["lpr", "-l", "-P", printer], input=zpl.encode("utf-8"),
                          capture_output=True, timeout=10)
    if proc.returncode != 0:
        raise RuntimeError("lpr error: " + proc.stderr.decode(errors="replace"))


class PrintServerHandler(http.server.BaseHTTPRequestHandler):
    api_key = ""
    allowed_origins = set(DEFAULT_ALLOWED_ORIGINS.split(","))

    def check_auth(self):
        if not self.api_key:
            return True
        
        # Check X-Api-Key header
        header_key = self.headers.get('X-Api-Key')
        if header_key == self.api_key:
            return True
            
        # Check Authorization header
        auth_header = self.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:].strip()
            if token == self.api_key:
                return True
        elif auth_header.strip() == self.api_key:
            return True
            
        return False

    def origin_allowed(self):
        origin = self.headers.get("Origin")
        return not origin or origin in self.allowed_origins

    def send_unauthorized(self):
        self.send_response(401)
        origin = self.headers.get('Origin')
        if origin and origin in self.allowed_origins:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key')
        self.end_headers()
        self.wfile.write(b"Unauthorized: Invalid or missing API key.")

    def end_headers(self):
        origin = self.headers.get('Origin')
        if origin and origin in self.allowed_origins:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            # Required when the hosted app accesses the user's loopback printer agent.
            self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key')
        super().end_headers()

    def do_OPTIONS(self):
        if not self.origin_allowed():
            self.send_response(403)
            self.end_headers()
            return
        self.send_response(204)
        self.end_headers()

    def read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("Invalid content length")
        if length < 1 or length > MAX_REQUEST_BYTES:
            raise ValueError("Request body must be between 1 byte and 1 MB")
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise ValueError("Incomplete request body")
        return raw.decode("utf-8")

    def do_OPTIONS_ORIGIN_GUARD(self):
        if not self.origin_allowed():
            self.send_response(403)
            self.end_headers()
            return False
        return True

    def do_GET(self):
        if not self.do_OPTIONS_ORIGIN_GUARD():
            return
        if not self.check_auth():
            self.send_unauthorized()
            return
        if self.path == '/printers':
            try:
                printers = get_installed_printers()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(printers).encode())
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if not self.do_OPTIONS_ORIGIN_GUARD():
            return
        if not self.check_auth():
            self.send_unauthorized()
            return
        if self.path == '/generate':
            try:
                post_data = self.read_json_body()
            except (ValueError, UnicodeDecodeError) as e:
                self.send_response(400); self.end_headers(); self.wfile.write(str(e).encode()); return
            try:
                params = json.loads(post_data)
                labels = params.get('labels', [])
                validate_labels(labels)
                zpl = build_zpl_from_labels(labels)
                self.send_response(200)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(zpl.encode())
            except ValueError as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(str(e).encode())
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())

        elif self.path == '/print':
            try:
                post_data = self.read_json_body()
            except (ValueError, UnicodeDecodeError) as e:
                self.send_response(400); self.end_headers(); self.wfile.write(str(e).encode()); return
            
            zpl = ''
            labels = []
            printer = ''
            params = {}

            try:
                params = json.loads(post_data)
            except json.JSONDecodeError:
                # Preserve support for callers that send raw ZPL text.
                zpl = post_data
            else:
                if not isinstance(params, dict):
                    self.send_response(400); self.end_headers(); self.wfile.write(b"JSON body must be an object."); return
                printer = params.get('printer', '')
                if 'labels' in params:
                    labels = params['labels']
                    try:
                        validate_labels(labels)
                    except ValueError as e:
                        self.send_response(400); self.end_headers(); self.wfile.write(str(e).encode()); return
                    zpl = build_zpl_from_labels(labels)
                elif isinstance(params.get('zpl'), str):
                    zpl = params['zpl']
                else:
                    self.send_response(400); self.end_headers(); self.wfile.write(b"Provide labels or ZPL text."); return

            if not zpl and not labels:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Empty ZPL or label data.")
                return

            # Virtual mode always writes a local ZPL file and never looks up or contacts a printer.
            is_virtual = params.get('virtual', False) if isinstance(params, dict) else False
            if is_virtual or os.environ.get("PRINT_SERVER_VIRTUAL_MODE") == "1":
                output_dir = os.path.join(os.path.expanduser("~"), "Documents", "Maxwell Printer Test")
                os.makedirs(output_dir, exist_ok=True)
                out_path = os.path.join(output_dir, "last_label_print.zpl")
                with open(out_path, "w", encoding="utf-8") as f:
                    f.write(zpl)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(f"Virtual test successful: generated {len(zpl)} bytes of ZPL at {out_path}".encode())
                return

            # Try loading saved printer configuration
            if not printer:
                try:
                    with open(os.path.expanduser("~/.bixolon_printer")) as f:
                        printer = f.read().strip()
                except Exception:
                    pass

            # Try system default destination
            if not printer:
                try:
                    printer = get_default_printer()
                except Exception:
                    pass

            # Fallback to first printer in list
            if not printer:
                try:
                    printers = get_installed_printers()
                    if printers:
                        printer = printers[0]
                except Exception:
                    pass

            if not zpl and not labels:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Empty ZPL or label data.")
                return

            if not printer:
                self.send_response(400)
                self.end_headers()
                message = ("No Windows printer found. Add a ZPL-compatible thermal printer in Settings > Bluetooth & devices > Printers & scanners."
                           if os.name == "nt" else
                           "No CUPS printer found. Add a thermal printer in macOS System Settings > Printers & Scanners, or use Browser Print / PDF.")
                self.wfile.write(message.encode())
                return

            # Support direct TCP socket printing (e.g. 192.168.1.50:9100)
            if ':' in printer or (printer.replace('.', '').isdigit() and printer.count('.') == 3):
                try:
                    import socket
                    host = printer.split(':')[0]
                    port = int(printer.split(':')[1]) if ':' in printer else 9100
                    with socket.create_connection((host, port), timeout=5) as s:
                        s.sendall(zpl.encode("utf-8"))
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(f"Printed {len(zpl)} bytes to network thermal printer at {printer}".encode())
                    return
                except Exception as e:
                    self.send_response(500)
                    self.end_headers()
                    self.wfile.write(f"Network printer connection error ({printer}): {e}".encode())
                    return

            # Submit raw ZPL to the Windows spooler or CUPS.
            try:
                send_raw_to_printer(printer, zpl)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(f"Printed successfully on {printer}".encode())
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description="Print Server Bridge")
    parser.add_argument("--host", default=os.environ.get("PRINT_SERVER_HOST", "127.0.0.1"), help="Host to bind server to (loopback only by default)")
    parser.add_argument("--allowed-origin", action="append", default=None, help="Browser origin allowed to access the local print bridge; repeat to add another")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PRINT_SERVER_PORT", PORT)), help="Port to bind server to")
    parser.add_argument("--api-key", default=os.environ.get("PRINT_SERVER_API_KEY", ""), help="API key required for printing")
    args = parser.parse_args()

    PrintServerHandler.api_key = args.api_key
    configured_origins = args.allowed_origin or os.environ.get("PRINT_SERVER_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS.split(","))
    if isinstance(configured_origins, str):
        configured_origins = configured_origins.split(",")
    PrintServerHandler.allowed_origins = {origin.strip().rstrip("/") for origin in configured_origins if origin.strip()}

    print(f"Starting print server bridge on {args.host}:{args.port}...")
    print("Allowed browser origins: " + ", ".join(sorted(PrintServerHandler.allowed_origins)))
    if args.api_key:
        print("API Key Authentication is ENABLED.")
    else:
        print("WARNING: API Key Authentication is DISABLED. Anyone can print!")
    print("Press Ctrl+C to stop.")
    
    server = http.server.ThreadingHTTPServer((args.host, args.port), PrintServerHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping print server bridge...")
    finally:
        server.server_close()
