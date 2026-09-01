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
  GradeSpec,
  LookName,
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

export type { HistoryOptions, HistoryState } from './history'
export {
  canRedo,
  canUndo,
  createHistory,
  push as pushHistory,
  redo,
  redoLabel,
  undo,
  undoLabel,
} from './history'

export type { AspectPreset, Insets, RetargetSpec } from './retarget'
export { ASPECT_PRESETS, otherAspects, retarget, retargetMaxWidth } from './retarget'

export {
  LOOKS,
  LUMA,
  applyGains,
  linearToSrgb,
  lutExpr,
  meanLinearFromRGBA,
  normaliseLook,
  planGains,
  planShotGains,
  trimGains,
  residual as gradeResidual,
  srgbToLinear,
  svgGradeFilter,
} from './grade'

export type { HtmlProblem, HtmlSource } from './html'
export { foreignObjectSvg, frameUrlAt, isStale, lintHtml, stampOf, wrapDocument } from './html'

export type { StoryboardMeta, StoryboardShot } from './storyboard'
export { buildStoryboard, toMarkdown as storyboardMarkdown } from './storyboard'

export type { ShotGrade } from './grade'
export type { AudioEffect, AudioEffectKind, GainPoint } from './audio'
export {
  AUDIO_PRESETS, compileChain, compileEffect, compileGainAutomation,
  dbToLinear, describeChain, linearToDb,
} from './audio'

export type { TransitionKind, TransitionSpec, TransitionResult } from './transitions'
export { MIN_DISSOLVE, TRANSITIONS, applyTransitions, framesLostTo } from './transitions'

export type { BeatAnalysis } from './beats'
export { analyseBeats, cutsFromDurations, durationsFromCuts, onsetCurve, snapToBeats } from './beats'

export { GRAPHICS_Z, isGraphic } from './compile'
export { evalNumber, evalPoint, isCurve, mapAnimatable, ramp } from './animate'

export type { Ctx2D } from './draw'
export { drawFrame, drawText, drawShape, drawBitmap, wrapText } from './draw'

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
export { PAN_SCALE, PAN_THROW, isLegacyProject, kenBurns, migrateLegacyProject, withExtraTrack } from './migrate'

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
