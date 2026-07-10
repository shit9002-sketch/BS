// 보험뉴스 수집기 — GitHub Actions가 1시간마다 실행
// RSS를 서버에서 받아 필터링 후 Supabase news 테이블에 upsert
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

const FEEDS = [
  ["보험저널","https://www.insjournal.co.kr/rss/allArticle.xml"],
  ["한국보험신문","https://www.insnews.co.kr/rss/allArticle.xml"],
  ["보험신보","https://www.insweek.co.kr/rss/allArticle.xml"],
  ["한국공제보험신문","https://www.kongje.or.kr/rss/allArticle.xml"],
  ["is보험","https://dazabi.com/insurance_magazine/rss.php"],
  ["심평원","http://www.hira.or.kr/cms/inform/02/news.xml"],
  ["보험매일","https://www.insdaily.co.kr/rss/allArticle.xml"],
  ["파이낸셜투데이","https://www.ftoday.co.kr/rss/allArticle.xml"],
  ["한국금융신문","https://www.fntimes.com/rss/allArticle.xml"]
];
const INC = ["실손","실손의료","실손보험","실비","4세대","건강보험","암보험","진단","보장","자동차보험","비급여","손해율","질병","입원","수술","간병","치매","보험금","청구","약관","특약","갱신","보험료","면책","자기부담","비례보상","화재보험","상해","후유장해","도수치료","백내장","유병자","간편보험","뇌졸중","심장","보상","지급","손해사정","보장분석","보험사기"];
const EXC = ["연금","저축","변액","IRP","퇴직","출시","신상품","이벤트","후원","캠페인","위촉","우수","수상","사회공헌","MOU","업무협약","봉사","기부","채용","공모","프로모션","할인","앰버서더","증정","경품","기념","GA","지에이","환수","시책","정착","리크루팅","스카우트","인수합병","매각","지분","순이익","실적","점포","대표이사","취임","조직개편","수수료","커미션","1200%","메타리치","인카","프라임에셋","토스인슈","리치앤코","광고","영업가족","TC","출범","모집","개설","사업단","신설","전속","영업본부","입사","연도대상","시상식","컨벤션","출정식","발대식"];

function pass(t){ t = t || ""; if (EXC.some(k => t.includes(k))) return false; return INC.some(k => t.includes(k)); }

function tag(xml, name){
  const m = new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">", "i").exec(xml);
  if (!m) return "";
  let s = m[1];
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return s.trim();
}

async function fetchFeed(name, url){
  try{
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = xml.split(/<item[>\s]/i).slice(1);
    return items.map(chunk => {
      const body = "<item " + chunk;
      return {
        src: name,
        title: tag(body, "title"),
        link: tag(body, "link"),
        date: tag(body, "pubDate"),
        description: tag(body, "description").slice(0, 200)
      };
    }).filter(x => x.title && x.link && x.link.startsWith("http"));
  } catch (e) { console.log("feed fail", name, e.message); return []; }
}

(async () => {
  const all = (await Promise.all(FEEDS.map(([n, u]) => fetchFeed(n, u)))).flat();
  const seen = new Set();
  const rows = [];
  for (const it of all){
    if (seen.has(it.link)) continue;
    if (!pass(it.title + " " + it.description)) continue;
    seen.add(it.link);
    let pub = null;
    try { const d = new Date(it.date); if (!isNaN(d)) pub = d.toISOString(); } catch (e) {}
    rows.push({ link: it.link, title: it.title, src: it.src, pub_date: pub, description: it.description });
  }
  rows.sort((a, b) => new Date(b.pub_date || 0) - new Date(a.pub_date || 0));
  const latest = rows.slice(0, 60);
  console.log("collected", latest.length, "articles");
  if (!latest.length) { console.log("nothing to upsert"); return; }
  const res = await fetch(SUPABASE_URL + "/rest/v1/news?on_conflict=link", {
    method: "POST",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": "Bearer " + SERVICE_KEY,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates"
    },
    body: JSON.stringify(latest)
  });
  const txt = await res.text();
  console.log("upsert status", res.status, txt.slice(0, 200));
})();
