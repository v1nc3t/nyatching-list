import { BaseMedia } from './media';

export interface Movie extends BaseMedia {
    mediaType: 'movie';
    currentMinutes: number;
    runtimeMinutes?: number;
    releaseYear?: number;
}