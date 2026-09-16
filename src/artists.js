// 各歌手在 YouTube Music 的官方藝人頻道與 Wikipedia 條目；slug 用於網址與資料檔名。
// 前端與 Node 抓取腳本共用這份清單，依出道日期（Wikipedia 資訊框的出道日期／出道作發行）排列。
export const ARTISTS = [
  { slug: 'ouyang-fei-fei', name: '歐陽菲菲', en: 'Ouyang Fei Fei', debut: '1966', channelId: 'UC5nvsmdF62lN570NZdxq84g', wiki: '歐陽菲菲' },
  { slug: 'teresa-teng', name: '鄧麗君', en: 'Teresa Teng', debut: '1967', channelId: 'UCI2cy2lwlzMksxEu63E8Zag', wiki: '鄧麗君' },
  { slug: 'feng-fei-fei', name: '鳳飛飛', en: 'Feng Fei Fei', debut: '1968', channelId: 'UCylxmFpXSfOsnuaOn5NCc1g', wiki: '鳳飛飛' },
  { slug: 'chyi-yu', name: '齊豫', en: 'Chyi Yu', debut: '1978', channelId: 'UCN82-y6I2oH9Tw8LaPw2sYg', wiki: '齊豫' },
  { slug: 'michelle-pan', name: '潘越雲', en: 'Michelle Pan', debut: '1979-10', channelId: 'UCCaauu_jc2rhNsx66SYjTKQ', wiki: '潘越雲' },
  { slug: 'stella-chang', name: '張清芳', en: 'Stella Chang', debut: '1984', channelId: 'UCgqKZd77uZDWKtZYViztZng', wiki: '張清芳' },
  { slug: 'sandy-lam', name: '林憶蓮', en: 'Sandy Lam', debut: '1985', channelId: 'UChwNyOQOnJ6n1H5EDnkpXhw', wiki: '林憶蓮' },
  { slug: 'winnie-hsin', name: '辛曉琪', en: 'Winnie Hsin', debut: '1986', channelId: 'UCmC8dCKfO3ZZtxYNvkadmxA', wiki: '辛曉琪' },
  { slug: 'cyndi-chao', name: '趙詠華', en: 'Cyndi Chao', debut: '1988', channelId: 'UCSCwNNMlx6buDMAvK4K6PGA', wiki: '趙詠華' },
  { slug: 'na-ying', name: '那英', en: 'Na Ying', debut: '1988', channelId: 'UC7tVAVl0FfQ4ylidGciMJZQ', wiki: '那英' },
  { slug: 'faye-wong', name: '王菲', en: 'Faye Wong', debut: '1989', channelId: 'UCnAmvOfJxmcMd5q48BEIuPQ', wiki: '王菲' },
  { slug: 'wan-fang', name: '萬芳', en: 'Wan Fang', debut: '1990', channelId: 'UC7W9UR7f56ZcmN-fGg4Pvww', wiki: '萬芳' },
  { slug: 'valen-hsu', name: '許茹芸', en: 'Valen Hsu', debut: '1995-06', channelId: 'UCZgpCUQ69DOR8OUKAxD8exw', wiki: '許茹芸' },
  { slug: 'rene-liu', name: '劉若英', en: 'Rene Liu', debut: '1995', channelId: 'UCWY-I1axwr3X9YiouSwHf5Q', wiki: '劉若英' },
  { slug: 'a-mei', name: '張惠妹', en: 'A-Mei', debut: '1996-12', channelId: 'UC5M7vIbPTCOMVF3lTtbeO6g', wiki: '張惠妹' },
  { slug: 'tanya-chua', name: '蔡健雅', en: 'Tanya Chua', debut: '1997', channelId: 'UCKbk-Nog0Sac_NHWntf3RHQ', wiki: '蔡健雅' },
  { slug: 'cheer-chen', name: '陳綺貞', en: 'Cheer Chen', debut: '1998-07', channelId: 'UC3Sf91aR21dEBHWwOxzXCRw', wiki: '陳綺貞' },
  { slug: 'jolin-tsai', name: '蔡依林', en: 'Jolin Tsai', debut: '1999-09-10', channelId: 'UC9dLsF7Ss7Wg0kR6TiIWiXg', wiki: '蔡依林' },
  { slug: 'fish-leong', name: '梁靜茹', en: 'Fish Leong', debut: '1999-09-17', channelId: 'UC8viexI7VBM6p632pCfTWRg', wiki: '梁靜茹' },
  { slug: 'penny-tai', name: '戴佩妮', en: 'Penny Tai', debut: '2000', channelId: 'UCwdCmULcaKruVB5XMxT3gLg', wiki: '戴佩妮' },
  { slug: 'hebe-tien', name: '田馥甄', en: 'Hebe Tien', debut: '2001-09', channelId: 'UCGkj4uoWx_1BA2tF9Q-9Y6w', wiki: '田馥甄' },
  { slug: 'a-lin', name: 'A-Lin', en: '黃麗玲', debut: '2006', channelId: 'UCh8MAQTB0y4JMTROjINKenA', wiki: 'A-Lin' },
  { slug: 'lala-hsu', name: '徐佳瑩', en: 'LaLa Hsu', debut: '2009', channelId: 'UC974iWoR_ZhWT6cNbZSaEdg', wiki: '徐佳瑩' },
  { slug: 'eve-ai', name: '艾怡良', en: 'Eve Ai', debut: '2010', channelId: 'UC_igPX3c9gOMQ41hSDV8tNg', wiki: '艾怡良' },
  { slug: '9m88', name: '9m88', en: '', debut: '2016', channelId: 'UCpZvDKDJtQUXm1o6LKT2xhA', wiki: '9m88' },
]

export const findArtist = (slug) => ARTISTS.find((a) => a.slug === slug)
