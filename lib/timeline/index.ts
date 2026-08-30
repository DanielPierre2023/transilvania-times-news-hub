// lib/timeline/index.ts
//
// tt-timeline — the Studio project document.
//
// Read this file to understand the module: every export is here, grouped by
// what it is for.

export type { Rational, FpsName } from './time'
export {
  FPS,
  rate,
  framesToSeconds,
  secondsToFrames,
  timecodeBase,
  isDropFrame,
  formatTimecode,
  parseTimecode,
  formatDuration,
} from './time'

export type {
  Animatable,
  CaptionWord,
  Clip,
  ClipAudio,
  DeliverySpec,
  Ease,
  Fit,
  Keyframe,
  LoudnessTarget,
  Marker,
  MediaSource,
  NormRect,
  Point,
  ShapeSource,
  Source,
  TemplateSource,
  TextSource,
  TextStyle,
  Timebase,
  Timeline,
  Track,
  TrackKind,
  Transform,
} from './types'

export { evalNumber, evalPoint, ramp } from './animate'

export type { CreateTimelineOptions, Problem } from './document'
export {
  DEFAULT_DELIVERY,
  IDENTITY_TRANSFORM,
  addClip,
  addMarker,
  clipEnd,
  contentDuration,
  createTimeline,
  emptyTrack,
  findClip,
  frames,
  isRenderable,
  moveClip,
  newId,
  removeClip,
  seconds,
  splitClip,
  trimClip,
  updateClip,
  validate,
} from './document'

export type {
  LegacyAspect,
  LegacyCue,
  LegacyKenBurns,
  LegacyProject,
  LegacyScene,
  LegacySubPos,
  MigrateOptions,
} from './migrate'
export { isLegacyProject, migrateLegacyProject, withExtraTrack } from './migrate'

export type { AudioOp, CompiledFrame, DrawOp, PixelRect } from './compile'
export { DUCK_GAIN, compileFrame, cutFrames, fitRect, frameRange } from './compile'

export type { CaptionLimits, CaptionOptions, CaptionProblem, Cue } from './captions'
export {
  DEFAULT_LIMITS,
  checkCaptions,
  conformCues,
  extractCues,
  toSRT,
  toVTT,
  wrapCaption,
} from './captions'

export type { AudioBufferLike, LoudnessResult, NormalisationPlan } from './loudness'
export {
  CHANNEL_WEIGHTS,
  LOUDNESS_TARGETS,
  formatLufs,
  kWeight,
  measureAudioBuffer,
  measureLoudness,
  planNormalisation,
} from './loudness'

export type {
  JobState,
  JobStatus,
  Limitation,
  RenderProvider,
  ShotstackAsset,
  ShotstackClip,
  ShotstackEdit,
  ShotstackOptions,
} from './render-spec'
export {
  RENDER_RATES,
  billableSeconds,
  describeLimitations,
  estimateCostUsd,
  readJobId,
  readJobStatus,
  toShotstackEdit,
} from './render-spec'
