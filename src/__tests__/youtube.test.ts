import { getTitleDirect, Youtube, YoutubeVideo } from '../youtube';

const VIDEOS: YoutubeVideo[] = [
    { 
        source: { type: 'youtube', videoId: '5dA5ynP-j-I' }, 
        details: { title: 'Tetris (CD-i) Music - Level 9', duration: 246000 },
    },
    { 
        source: { type: 'youtube', videoId: '2GjyNgQ4Dos' },
        details: { title: 'dobby pussy indulgence', duration: 20000 },
    },
];

const FAKE_VIDEO: YoutubeVideo = {
    source: { type: 'youtube', videoId: '' },
    details: { title: 'fake video', duration: 1000 },
};

test.each(VIDEOS)('getTitleDirect', async (knownVideo) => {
    const title = await getTitleDirect(knownVideo.source.videoId);
    expect(title).toEqual(knownVideo.details.title);
});

test.each(VIDEOS)('youtube.details', async (knownVideo) => {
    const youtube = new Youtube();
    const details = await youtube.details(knownVideo.source.videoId);
    expect(details).toEqual(knownVideo);
});

it('throws exception for unobtainable details', async () => {
    const youtube = new Youtube();
    const check = youtube.details('really fake video id');
    await expect(check).rejects.toThrow(Error);
});

it('loads copied state', async () => {
    const youtube1 = new Youtube();
    const youtube2 = new Youtube();

    const video = VIDEOS[0];
    youtube1.addVideo(video);
    youtube2.loadState(youtube1.copyState());
    expect(await youtube2.details(video.source.videoId)).toEqual(video);
});

it('can copy empty state', async () => {
    const youtube1 = new Youtube();
    const youtube2 = new Youtube();
    youtube2.addVideo(FAKE_VIDEO);
    youtube2.loadState(youtube1.copyState());
    const check = youtube2.details(FAKE_VIDEO.source.videoId);
    await expect(check).rejects.toThrow(Error);
});

it('remembers queried videos', async () => {
    const youtube = new Youtube();
    for (const video of VIDEOS) await youtube.details(video.source.videoId);
    expect(youtube.copyState().videos.length).toBeGreaterThanOrEqual(VIDEOS.length);
});
