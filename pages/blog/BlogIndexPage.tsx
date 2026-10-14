import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { blogPosts, getBlogRoute } from '@/lib/blog';

/**
 * Blog liste sayfası. Prerender sırasında oturum sağlayıcısı olmadığı için
 * portal kabuğu yerine kendi başlık/alt bilgi düzenini kullanır; görsel dil
 * uygulamanın geri kalanıyla aynı token'lara dayanır.
 */

const ALL_TAG = 'Tümü';

const BlogIndexPage = () => {
  const [activeTag, setActiveTag] = useState<string>(ALL_TAG);

  const tags = useMemo(() => {
    const set = new Set<string>();
    blogPosts.forEach((post) => {
      post.frontmatter.tags?.forEach((tag) => set.add(tag));
    });
    return [ALL_TAG, ...Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'))];
  }, []);

  const visiblePosts = useMemo(
    () =>
      activeTag === ALL_TAG
        ? blogPosts
        : blogPosts.filter((post) => post.frontmatter.tags?.includes(activeTag)),
    [activeTag],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-screen-xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <img
              src="/assets/edusetupplus-icon.png?v=4"
              alt="EduSetupPlus"
              width={36}
              height={36}
              className="h-9 w-9 shrink-0 rounded-xl object-contain ring-1 ring-border"
            />
            <span className="leading-tight">
              <span className="block text-sm font-extrabold">EduSetupPlus</span>
              <span className="block text-[11px] text-muted-foreground">Blog</span>
            </span>
          </Link>
          <nav className="ml-auto flex flex-wrap items-center gap-1 text-xs font-semibold">
            <Link to="/" className="rounded-md px-2.5 py-1.5 hover:md:bg-accent">
              Ana sayfa
            </Link>
            <Link to="/hakkimizda" className="rounded-md px-2.5 py-1.5 hover:md:bg-accent">
              Hakkımızda
            </Link>
            <Link to="/nasil-calisir" className="rounded-md px-2.5 py-1.5 hover:md:bg-accent">
              Nasıl çalışır
            </Link>
            <Link to="/iletisim" className="rounded-md px-2.5 py-1.5 hover:md:bg-accent">
              İletişim
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-screen-xl px-4 py-8 sm:px-6 sm:py-12">
        <section className="relative overflow-hidden rounded-[28px] border bg-slate-950 p-6 text-slate-100 shadow-2xl shadow-primary/20 sm:p-10">
          <div className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-primary/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-violet-500/20 blur-3xl" />
          <div className="relative max-w-3xl space-y-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em]">
              Rehber içerikler
            </span>
            <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">
              Deneme analizi, etüt planlama ve okul yönetimi üzerine uygulamalı yazılar
            </h1>
            <p className="text-sm leading-7 text-slate-300 sm:text-base">
              Netleri yorumlamaktan taksit takibine, ders programı kurmaktan veli görüşmesine
              kadar kurumların günlük işlerinde kullandığı konuları adım adım ele alıyoruz.
            </p>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {blogPosts.length} makale
            </p>
          </div>
        </section>

        {tags.length > 1 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {tags.map((tag) => {
              const active = tag === activeTag;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setActiveTag(tag)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:md:bg-accent'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visiblePosts.length > 0 ? (
            visiblePosts.map((post) => (
              <article
                key={post.slug}
                className="flex flex-col rounded-2xl border bg-card p-5 shadow-sm transition-transform duration-200 hover:md:-translate-y-1"
              >
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  {post.frontmatter.date ? <span>{post.frontmatter.date}</span> : null}
                  {post.frontmatter.tags?.slice(0, 2).map((tag) => (
                    <span key={tag} className="rounded-full bg-primary/10 px-2 py-0.5 font-bold text-primary">
                      {tag}
                    </span>
                  ))}
                </div>
                <h2 className="mt-3 text-lg font-extrabold leading-snug">
                  <Link className="hover:text-primary" to={getBlogRoute(post.slug)}>
                    {post.title}
                  </Link>
                </h2>
                <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">
                  {post.description}
                </p>
                <Link
                  to={getBlogRoute(post.slug)}
                  className="mt-4 inline-flex text-xs font-bold text-primary underline underline-offset-4"
                >
                  Yazıyı oku
                </Link>
              </article>
            ))
          ) : (
            <section className="rounded-2xl border border-dashed bg-card p-8 md:col-span-2 xl:col-span-3">
              <h2 className="text-lg font-extrabold">Bu etikette yazı yok</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Farklı bir etiket seçebilir veya tüm yazıları görüntüleyebilirsiniz.
              </p>
            </section>
          )}
        </div>

        <section className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-primary/5 p-6">
          <div>
            <p className="text-base font-extrabold">Panelde kendi verinizle deneyin</p>
            <p className="text-sm text-muted-foreground">
              Deneme dosyanızı yükleyin, karne ve eksik konu listesi kendiliğinden oluşsun.
            </p>
          </div>
          <Link
            to="/"
            className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
          >
            Panele git
          </Link>
        </section>
      </main>

      <footer className="mt-8 border-t bg-card">
        <div className="mx-auto flex max-w-screen-xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:px-6">
          <span>© {new Date().getFullYear()} EduSetupPlus · Okul &amp; Kurs Yönetim Portalı</span>
          <span className="flex flex-wrap gap-3">
            <Link to="/hakkimizda" className="hover:underline">
              Hakkımızda
            </Link>
            <Link to="/nasil-calisir" className="hover:underline">
              Nasıl çalışır
            </Link>
            <Link to="/iletisim" className="hover:underline">
              İletişim
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
};

export default BlogIndexPage;