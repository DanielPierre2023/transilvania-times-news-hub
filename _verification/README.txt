DO NOT COMMIT THIS FOLDER. Evidence, not repo code.

Suite 7 now covers the one-time download key: refused with no key, refused with
a wrong key of the same length, refused with a short key (which is where a
naive timing-safe comparison throws), accepted with the right one, and one
job's key refused on another job.
