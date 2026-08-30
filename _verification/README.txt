DO NOT COMMIT THIS FOLDER. Evidence, not repo code.

164 assertions across five suites, all passing.

Suite 2 compares the loudness implementation against ffmpeg's ebur128.
Suite 4 checks the render spec against the Shotstack schema, including the
track-order inversion and the flipped Y axis — the two things that are silently
wrong if you assume they match the timeline's own conventions.
