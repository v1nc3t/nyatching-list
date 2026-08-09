import { TrackedMedia } from './index';
import { Show } from './show';
import { Movie } from './movie';

export function isShow(media: TrackedMedia): media is Show {
  return media.mediaType === 'show';
}

export function isMovie(media: TrackedMedia): media is Movie {
  return media.mediaType === 'movie';
}