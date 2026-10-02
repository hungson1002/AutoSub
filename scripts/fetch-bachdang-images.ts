import { fetchRealImagePack } from '../server/services/realImageTool';

const pack = await fetchRealImagePack(
  ['Bach Dang stakes 1288', 'Battle of Bach Dang river map', 'Bach Dang river Vietnam'],
  { perKeyword: 2 },
);
console.log(JSON.stringify(pack.map((p) => ({
  title: p.title, license: p.license, author: p.author.slice(0, 40),
  width: p.width, height: p.height, credit: p.credit,
  imageUrl: p.imageUrl.slice(0, 110), localPath: p.localPath,
})), null, 2));
