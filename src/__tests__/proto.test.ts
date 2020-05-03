import * as FormData from 'form-data';
import { fetchDom } from '../utility';

it('test', async () => {
    const url = "https://www.youtube.com/watch?v=SqIPDAsmSjg";
    const form = new FormData();
    form.append('url', encodeURI(url));
    form.append('ajax', 1);
    const dom = await fetchDom('https://getvideo.id/get_video', { method: 'post', body: form, });
    console.log(dom.querySelector('.btn-success').getAttribute('href'));
});
