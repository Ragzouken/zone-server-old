import youtube, { getTitleDirect } from '../youtube';
import { YOUTUBE_VIDEOS } from './test-data';

test.each(YOUTUBE_VIDEOS)('getTitleDirect', async ({ videoId, title }) => {
    expect(await getTitleDirect(videoId)).toEqual(title);
});

test.each(YOUTUBE_VIDEOS)('youtube.details', async ({ videoId, title, duration }) => {
    const details = await youtube.details(videoId);
    details.thumbnail = undefined;
    expect(details).toEqual({ videoId, title, duration });
});
