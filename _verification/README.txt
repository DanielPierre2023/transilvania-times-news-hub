DO NOT COMMIT THIS FOLDER. Evidence, not repo code.

112 assertions across three suites, all passing.

Suite 2 compares this loudness implementation against ffmpeg's ebur128 —
a trusted reference — on five generated signals including a 44.1 kHz file
to prove the filter derivation is not hard-coded to 48 kHz.
