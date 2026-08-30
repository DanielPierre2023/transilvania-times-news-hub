DO NOT COMMIT THIS FOLDER. Evidence, not repo code.

Suite 6 renders a real 10-second 1080p MP4 and inspects it with ffprobe and
ebur128: exact frame count, exact duration, delivered loudness, and the same
timeline rendered twice producing byte-identical picture and sound.

Suite 7 drives the worker over HTTP: auth, validation, the job queue, the QC
report, and downloading the finished file.
