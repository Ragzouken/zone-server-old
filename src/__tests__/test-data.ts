import { YoutubeVideo } from '../youtube';
import { HTTPSource } from '../archiveorg';
import { PlayableMedia } from '../playback';

export const TINY_MEDIA: PlayableMedia = {
    source: { type: 'null' },
    details: { title: 'tiny', duration: 100, },
};

export const DAY_MEDIA: PlayableMedia = {
    source: { type: 'null' },
    details: { title: 'day', duration: 24 * 60 * 60 * 1000, },
};
