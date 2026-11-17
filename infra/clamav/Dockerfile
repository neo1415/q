# Capital Q malware scanner (decision 104; ADR 0042 reversal).
#
# The official ClamAV image, unchanged except for its limits: clamd listens
# on TCP 3310 for the workers on the private network, and freshclam updates
# the signatures at start and then 12 times a day. No public port, no
# credentials, no document is stored: clamd scans the stream it is sent and
# keeps nothing.
#
# The tag follows the 1.4 LTS line; bump it deliberately.
FROM clamav/clamav:1.4

# The upload ceiling is 50 MiB (DOCUMENT_MAX_SIZE_BYTES, CQ_DOCUMENT_MAX_BYTES).
# clamd's default stream limit is 25 MiB, which would turn every larger deck
# into a scanner error, so the stream and file limits sit above the ceiling.
# Archives (a .docx, .pptx or .xlsx is a zip) expand, so the scan limit is
# larger still. Existing settings are removed first so each is set once.
RUN set -eu; \
    conf=/etc/clamav/clamd.conf; \
    for key in TCPSocket StreamMaxLength MaxFileSize MaxScanSize \
               ReadTimeout CommandReadTimeout MaxThreads \
               MaxConnectionQueueLength ConcurrentDatabaseReload; do \
      sed -i "/^#\{0,1\}[[:space:]]*${key}[[:space:]]/d" "$conf"; \
    done; \
    printf '%s\n' \
      'TCPSocket 3310' \
      'StreamMaxLength 64M' \
      'MaxFileSize 64M' \
      'MaxScanSize 256M' \
      'ReadTimeout 180' \
      'CommandReadTimeout 30' \
      'MaxThreads 4' \
      'MaxConnectionQueueLength 30' \
      'ConcurrentDatabaseReload yes' >> "$conf"; \
    fconf=/etc/clamav/freshclam.conf; \
    sed -i "/^#\{0,1\}[[:space:]]*Checks[[:space:]]/d" "$fconf"; \
    printf '%s\n' 'Checks 12' >> "$fconf"

EXPOSE 3310

# clamdcheck.sh ships with the image: it PINGs clamd and expects PONG. The
# first start downloads the signatures (a few minutes), hence the long start.
HEALTHCHECK --interval=60s --timeout=10s --start-period=600s --retries=3 \
  CMD clamdcheck.sh
