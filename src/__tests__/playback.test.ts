import Playback, { PlayableMedia } from '../playback';
import { TINY_MEDIA, DAY_MEDIA } from './test-data';
import { once } from 'events';

const MEDIA: PlayableMedia[] = [TINY_MEDIA, DAY_MEDIA];

it('plays the first item queued', () => {
    const playback = new Playback();
    MEDIA.forEach((media) => playback.queueMedia(media));
    expect(playback.currentMedia).toEqual(MEDIA[0]);
});

it('removes the playing item from the queue', () => {
    const playback = new Playback();
    MEDIA.forEach((media) => playback.queueMedia(media));
    expect(playback.queue).toEqual(MEDIA.slice(1));
});

test('loading copied state', () => {
    const playback = new Playback();
    const other = new Playback();
    MEDIA.forEach((media) => playback.queueMedia(media));
    other.loadState(playback.copyState());
    expect(other.currentMedia).toEqual(playback.currentMedia);
    expect(other.queue).toEqual(playback.queue);
});

it('can copy empty state', () => {
    const playback = new Playback();
    const other = new Playback();
    other.loadState(playback.copyState());
    expect(other.currentMedia).toEqual(playback.currentMedia);
    expect(other.queue).toEqual(playback.queue);
});

it('continues the queue when a video ends', async () => {
    const playback = new Playback();
    playback.queueMedia(TINY_MEDIA);
    playback.queueMedia(DAY_MEDIA);
    expect(playback.currentMedia).toBe(TINY_MEDIA);
    await once(playback, 'play');
    expect(playback.currentMedia).toBe(DAY_MEDIA);
});

it('stops when last item ends', async () => {
    const playback = new Playback();
    const stopped = once(playback, 'stop');
    playback.queueMedia(TINY_MEDIA);
    await stopped;
});

it('stops when last item skipped', async () => {
    const playback = new Playback();
    const stopped = once(playback, 'stop');
    playback.queueMedia(DAY_MEDIA);
    playback.skip();
    await stopped;
});

it('continues the queue when an item is skipped', async () => {
    const playback = new Playback();
    playback.queueMedia(TINY_MEDIA);
    MEDIA.forEach((video) => playback.queueMedia(video));
    expect(playback.currentMedia).toBe(TINY_MEDIA);
    playback.skip();
    expect(playback.currentMedia).toBe(MEDIA[0]);
});

test('queue proceeds normally after loading state', async () => {
    const playback = new Playback();
    const other = new Playback();
    playback.queueMedia(TINY_MEDIA);
    playback.queueMedia(DAY_MEDIA);
    other.loadState(playback.copyState());
    await once(other, 'play');
    expect(other.currentMedia).toBe(DAY_MEDIA);
});
