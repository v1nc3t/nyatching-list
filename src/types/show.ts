import { BaseMedia } from './media';

export interface Show extends BaseMedia {
    mediaType: 'show';
    currentSeason: number;
    currentEpisode: number;
    totalSeasons?: number;
}