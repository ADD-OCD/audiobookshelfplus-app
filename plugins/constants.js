const DownloadStatus = {
  PENDING: 0,
  READY: 1,
  EXPIRED: 2,
  FAILED: 3
}

const SyncStatus = {
  UNSET: 0,
  SUCCESS: 1,
  FAILED: 2
}

const CoverDestination = {
  METADATA: 0,
  AUDIOBOOK: 1
}

const BookCoverAspectRatio = {
  STANDARD: 0,
  SQUARE: 1
}

const PlayMethod = {
  DIRECTPLAY: 0,
  DIRECTSTREAM: 1,
  TRANSCODE: 2,
  LOCAL: 3
}

const PlayerState = {
  IDLE: 0,
  BUFFERING: 1,
  READY: 2,
  ENDED: 3
}

const PodcastEpisodeSortItems = [
  { value: 'publishedAt', labelKey: 'LabelPubDate' },
  { value: 'title', labelKey: 'LabelTitle' },
  { value: 'season', labelKey: 'LabelSeason' },
  { value: 'episode', labelKey: 'LabelEpisode' },
  { value: 'audioFile.metadata.filename', labelKey: 'LabelFilename' }
]

const Constants = {
  DownloadStatus,
  SyncStatus,
  CoverDestination,
  BookCoverAspectRatio,
  PlayMethod,
  PlayerState,
  PodcastEpisodeSortItems
}

export {
  PlayMethod,
  PlayerState,
  BookCoverAspectRatio
}

export default ({ app }, inject) => {
  inject('constants', Constants)
}