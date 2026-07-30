# zaltr.ai — runner code interpreter (Python, terisolasi)
# Jalan di network internal TANPA internet dan TANPA akses service zaltr lain.
FROM python:3.12-slim

# Beberapa lib analisis umum agar tombol "Jalankan" berguna (tanpa GPU).
RUN pip install --no-cache-dir numpy pandas matplotlib sympy \
    && useradd --create-home --shell /usr/sbin/nologin runner

COPY server.py /srv/server.py

USER runner
WORKDIR /home/runner

EXPOSE 8484
CMD ["python", "/srv/server.py"]
