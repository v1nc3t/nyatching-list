export type MediaStatus = 'watching' | 'waiting' | 'completed' | 'dropped';

export interface BaseMedia {
    id: string;
    title: string;
    status: MediaStatus;
    watchingUrl: string;
    updatedAt: number;
}