"""
Python API server for PDF Merge and PDF Digital Signature endpoints.
Runs alongside the existing Node.js server on a separate port.
"""

import io
import os
import base64

from flask import Flask, request, send_file, jsonify
from flask_cors import CORS
from pypdf import PdfReader, PdfWriter
from PIL import Image
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.lib.utils import ImageReader

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# Utility: Strip white/near-white background from a signature image
# ---------------------------------------------------------------------------

def strip_white_background(img_bytes):
    """Convert white/near-white pixels to transparent so the signature
    overlays cleanly on the PDF page."""
    img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
    data = img.getdata()
    new_data = []
    for r, g, b, a in data:
        if r > 200 and g > 200 and b > 200:
            new_data.append((255, 255, 255, 0))  # transparent
        else:
            new_data.append((r, g, b, a))
    img.putdata(new_data)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


# ---------------------------------------------------------------------------
# Utility: Embed a signature image onto a specific page of a PDF
# ---------------------------------------------------------------------------

def embed_signature_on_pdf(pdf_bytes, sig_png_bytes, page_num, x_pct, y_pct, width_pct):
    """
    Overlay a transparent signature PNG onto a given page of a PDF.

    Parameters
    ----------
    pdf_bytes : bytes        – raw bytes of the source PDF
    sig_png_bytes : bytes    – PNG image bytes (already transparency-stripped)
    page_num : int           – 1-indexed page number
    x_pct : float            – X position as % of page width  (0-100)
    y_pct : float            – Y position as % of page height (0-100)
    width_pct : float        – signature width as % of page width
    """
    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter()
    target_page = reader.pages[page_num - 1]

    page_width = float(target_page.mediabox.width)
    page_height = float(target_page.mediabox.height)

    sig_x = (x_pct / 100) * page_width
    sig_y = page_height - ((y_pct / 100) * page_height)  # flip Y axis
    sig_w = (width_pct / 100) * page_width

    # Compute height preserving aspect ratio
    sig_img = Image.open(io.BytesIO(sig_png_bytes))
    aspect = sig_img.height / sig_img.width
    sig_h = sig_w * aspect

    # Render signature onto a temporary single-page PDF via reportlab
    sig_pdf_buffer = io.BytesIO()
    c = rl_canvas.Canvas(sig_pdf_buffer, pagesize=(page_width, page_height))
    sig_img_reader = ImageReader(io.BytesIO(sig_png_bytes))
    c.drawImage(sig_img_reader, sig_x, sig_y - sig_h,
                width=sig_w, height=sig_h, mask='auto')
    c.save()

    sig_pdf_buffer.seek(0)
    sig_reader = PdfReader(sig_pdf_buffer)
    sig_layer = sig_reader.pages[0]

    # Merge the signature layer onto the target page
    target_page.merge_page(sig_layer)

    for i, page in enumerate(reader.pages):
        if i == page_num - 1:
            writer.add_page(target_page)
        else:
            writer.add_page(page)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


# ===========================================================================
# Endpoint 1 — POST /api/merge-pdf
# ===========================================================================

@app.route('/api/merge-pdf', methods=['POST'])
def merge_pdf():
    """
    Accepts multiple PDF files as multipart/form-data (field: files[]),
    merges them in the order received, and returns the merged PDF.
    """
    try:
        files = request.files.getlist('files[]')

        if not files or len(files) < 2:
            return jsonify({'error': 'Please upload at least 2 PDF files to merge.'}), 400

        writer = PdfWriter()

        for f in files:
            try:
                reader = PdfReader(io.BytesIO(f.read()))
                for page in reader.pages:
                    writer.add_page(page)
            except Exception as e:
                return jsonify({'error': f'Failed to process file {f.filename}: {str(e)}'}), 400

        output = io.BytesIO()
        writer.write(output)
        output.seek(0)

        if output.getbuffer().nbytes == 0:
            return jsonify({'error': 'Failed to generate merged PDF.'}), 500

        return send_file(
            output,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='merged.pdf',
        )

    except Exception as e:
        print(f'Merge PDF Error: {e}')
        return jsonify({'error': 'Internal server error during PDF merge.'}), 500


# ===========================================================================
# Endpoint 2 — POST /api/sign-pdf
# ===========================================================================

@app.route('/api/sign-pdf', methods=['POST'])
def sign_pdf():
    """
    Accepts a PDF and a signature (drawn base64 or uploaded image),
    overlays the signature on the specified page, and returns the signed PDF.
    """
    try:
        # --- Validate PDF ------------------------------------------------
        if 'pdf' not in request.files:
            return jsonify({'error': 'No PDF file provided.'}), 400

        pdf_file = request.files['pdf']
        pdf_bytes = pdf_file.read()

        if not pdf_bytes:
            return jsonify({'error': 'Uploaded PDF is empty.'}), 400

        # --- Signature mode ----------------------------------------------
        signature_mode = request.form.get('signature_mode', '').strip().lower()

        if signature_mode not in ('draw', 'upload'):
            return jsonify({'error': 'signature_mode must be "draw" or "upload".'}), 400

        sig_img_bytes = None

        if signature_mode == 'draw':
            signature_data = request.form.get('signature_data', '')
            if not signature_data:
                return jsonify({'error': 'signature_data is required when mode is "draw".'}), 400
            # Strip optional data-URI prefix (e.g. "data:image/png;base64,")
            if ',' in signature_data:
                signature_data = signature_data.split(',', 1)[1]
            try:
                sig_img_bytes = base64.b64decode(signature_data)
            except Exception:
                return jsonify({'error': 'Invalid base64 in signature_data.'}), 400

        elif signature_mode == 'upload':
            if 'signature_file' not in request.files:
                return jsonify({'error': 'signature_file is required when mode is "upload".'}), 400
            sig_img_bytes = request.files['signature_file'].read()
            if not sig_img_bytes:
                return jsonify({'error': 'Uploaded signature file is empty.'}), 400

        # --- Strip white background to get transparent PNG ----------------
        sig_png_bytes = strip_white_background(sig_img_bytes)

        # --- Placement parameters ----------------------------------------
        reader_tmp = PdfReader(io.BytesIO(pdf_bytes))
        total_pages = len(reader_tmp.pages)

        try:
            page_num = int(request.form.get('page', total_pages))
        except (TypeError, ValueError):
            page_num = total_pages

        if page_num < 1 or page_num > total_pages:
            return jsonify({
                'error': f'Page number must be between 1 and {total_pages}.'
            }), 400

        try:
            x_pct = float(request.form.get('x', 60))
        except (TypeError, ValueError):
            x_pct = 60.0

        try:
            y_pct = float(request.form.get('y', 85))
        except (TypeError, ValueError):
            y_pct = 85.0

        try:
            width_pct = float(request.form.get('width', 20))
        except (TypeError, ValueError):
            width_pct = 20.0

        # Clamp values to 0-100
        x_pct = max(0, min(100, x_pct))
        y_pct = max(0, min(100, y_pct))
        width_pct = max(1, min(100, width_pct))

        # --- Embed signature and return ----------------------------------
        signed_pdf_bytes = embed_signature_on_pdf(
            pdf_bytes, sig_png_bytes, page_num, x_pct, y_pct, width_pct
        )

        output = io.BytesIO(signed_pdf_bytes)
        output.seek(0)

        return send_file(
            output,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='signed.pdf',
        )

    except Exception as e:
        print(f'Sign PDF Error: {e}')
        return jsonify({'error': f'Internal server error during PDF signing: {str(e)}'}), 500


# ===========================================================================
# Run
# ===========================================================================

if __name__ == '__main__':
    port = int(os.environ.get('PYTHON_API_PORT', 5001))
    print(f'Python API server running on port {port}')
    app.run(host='0.0.0.0', port=port, debug=True)
