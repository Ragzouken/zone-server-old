import { archiveOrgToPlayableHTTP } from '../archiveorg';
import { ARCHIVE_PATH_TO_MEDIA } from './media.data';

test.each(ARCHIVE_PATH_TO_MEDIA)('path gives expected media', async ({ path, media }) => {
    const actual = await archiveOrgToPlayableHTTP(path);
    expect(actual).toEqual(media);
});
