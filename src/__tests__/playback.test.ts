import { sleep } from '../utility';
import Playback from '../playback';
import { YOUTUBE_VIDEOS, TINY_YOUTUBE_VIDEO, DAY_YOUTUBE_VIDEO } from './test-data';
import { YoutubeVideo } from '../youtube';

function waitTime(video: YoutubeVideo) {
    return video.duration * 1000 * 2 + 1000;
}

it('plays the first item queued', () => {
    const playback = new Playback();
    YOUTUBE_VIDEOS.forEach((video) => playback.queueYoutube(video));
    expect(playback.currentVideo).toEqual(YOUTUBE_VIDEOS[0]);
});

it('removes the playing item from the queue', () => {
    const playback = new Playback();
    YOUTUBE_VIDEOS.forEach((video) => playback.queueYoutube(video));
    expect(playback.queue).toEqual(YOUTUBE_VIDEOS.slice(1));
});

test('loading copied state', () => {
    const playback = new Playback();
    const other = new Playback();
    YOUTUBE_VIDEOS.forEach((video) => playback.queueYoutube(video));
    other.loadState(playback.copyState());
    expect(other.currentVideo).toEqual(playback.currentVideo);
    expect(other.queue).toEqual(playback.queue);
});

it('can copy empty state', () => {
    const playback = new Playback();
    const other = new Playback();
    other.loadState(playback.copyState());
    expect(other.currentVideo).toEqual(playback.currentVideo);
    expect(other.queue).toEqual(playback.queue);
});

it('continues the queue when a video ends', async () => {
    const playback = new Playback();
    playback.queueYoutube(TINY_YOUTUBE_VIDEO);
    playback.queueYoutube(DAY_YOUTUBE_VIDEO);
    expect(playback.currentVideo).toBe(TINY_YOUTUBE_VIDEO);
    await sleep(waitTime(TINY_YOUTUBE_VIDEO));
    expect(playback.currentVideo).toBe(DAY_YOUTUBE_VIDEO);
});

it('stops when last video ends', async () => {
    const playback = new Playback();
    const onStop = jest.fn();
    playback.on('stop', onStop);
    playback.queueYoutube(TINY_YOUTUBE_VIDEO);
    await sleep(waitTime(TINY_YOUTUBE_VIDEO));
    expect(onStop.mock.calls.length).toBe(1);
});

it('continues the queue when a video skipped', () => {
    const playback = new Playback();
    playback.queueYoutube(TINY_YOUTUBE_VIDEO);
    YOUTUBE_VIDEOS.forEach((video) => playback.queueYoutube(video));
    expect(playback.currentVideo).toBe(TINY_YOUTUBE_VIDEO);
    playback.skip();
    expect(playback.currentVideo).toBe(YOUTUBE_VIDEOS[0]);
});

it('stops when last video skipped', () => {
    const playback = new Playback();
    const onStop = jest.fn();
    playback.on('stop', onStop);
    playback.queueYoutube(TINY_YOUTUBE_VIDEO);
    playback.skip();
    expect(onStop.mock.calls.length).toBe(1);
});

it('queues correct youtube by id', async () => {
    const playback = new Playback();
    await playback.queueYoutubeById(YOUTUBE_VIDEOS[0].videoId, {});
    const { videoId, title, duration } = playback.currentVideo!;
    expect({ videoId, title, duration }).toEqual(YOUTUBE_VIDEOS[0]);
});

it('continues the queue when a video ends after loading state', async () => {
    const playback = new Playback();
    const other = new Playback();
    playback.queueYoutube(TINY_YOUTUBE_VIDEO);
    playback.queueYoutube(DAY_YOUTUBE_VIDEO);
    other.loadState(playback.copyState());
    await sleep(waitTime(TINY_YOUTUBE_VIDEO));
    expect(other.currentVideo).toBe(DAY_YOUTUBE_VIDEO);
});
