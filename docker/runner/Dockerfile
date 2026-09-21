# zaltr.ai — runner code interpreter (Python, terisolasi)
# Jalan di network internal TANPA internet dan TANPA akses service zaltr lain.
FROM python:3.12-slim

# Lib analisis + PEMBUAT/PENYUNTING DOKUMEN (Word, PDF, Excel, PPT, gambar) agar
# agen bisa menghasilkan/mengedit berkas nyata untuk pengguna (tanpa GPU).
RUN pip install --no-cache-dir numpy pandas matplotlib sympy \
    python-docx openpyxl python-pptx pypdf reportlab fpdf2 Pillow markdown \
    && useradd --create-home --shell /usr/sbin/nologin runner

COPY server.py /srv/server.py

USER runner
WORKDIR /home/runner

EXPOSE 8484
CMD ["python", "/srv/server.py"]
