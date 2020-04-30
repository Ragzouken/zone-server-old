import { fetchJson } from './utility';
import { PlayableMedia, PlayableSource } from './playback';

export interface HTTPSource extends PlayableSource {
    type: 'http';
    src: string;
}

export type Metadata = { metadata: { title?: string }; files: File[] };
export type File = { title?: string; name: string; format: string; length?: string };

export async function archiveOrgToPlayableHTTP(path: string): Promise<PlayableMedia<HTTPSource>> {
    const [item, filename] = path.includes('/') ? path.split('/') : [path, undefined];

    const metadata = (await fetchJson(`https://archive.org/metadata/${item}`)) as Metadata;
    const file = filename
        ? metadata.files.find((file) => file.name === filename)
        : metadata.files.find((file) => file.format === 'MPEG4');

    if (!file || !file.length) {
        throw new Error('invalid file');
    }

    const title = file.title || metadata.metadata.title || file.name;
    const duration = parseFloat(file.length) * 1000;
    const src = `https://archive.org/download/${item}/${file.name}`;

    return {
        details: { title, duration },
        source: { type: 'http', src },
    };
}
