'use strict';
/**
 * buscador.js — Detalle de noticia (/noticia/:slug):
 * Carga el artículo completo, claves informativas, atribución, compartir y noticias relacionadas.
 */

function slugFromPath() {
  const clean = location.pathname.replace(/\/+$/, '');
  const m = clean.match(/\/noticia\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function setMeta(attr, tag, value) {
  if (!value) return;
  let el = document.head.querySelector(`meta[${attr}="${tag}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, tag);
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
}

function estimateReadTime(text) {
  const words = (text || '').trim().split(/\s+/).length;
  const minutes = Math.max(1, Math.ceil(words / 180));
  return `${minutes} min de lectura`;
}

function generateKeyPoints(n) {
  const points = [];
  const title = (n.title || '').trim();
  const summary = (n.summary || '').trim();

  if (title) {
    points.push(`<strong>Hecho principal:</strong> ${esc(title)}`);
  }
  if (summary && summary !== title) {
    // Tomar la primera frase del sumario
    const firstSentence = summary.split(/[.!?]/)[0];
    if (firstSentence) points.push(`<strong>Detalle informativo:</strong> ${esc(firstSentence.trim())}.`);
  }
  const isAyamonte = n.section === 'ayamonte';
  points.push(
    `<strong>Ámbito local:</strong> Información clasificada en <em>${isAyamonte ? 'Noticias de Ayamonte' : 'Noticias comarcales'}</em> con seguimiento de la actualidad en ${isAyamonte ? 'Ayamonte y su término municipal' : 'la comarca de la Costa Occidental de Huelva'}.`
  );

  return points;
}

function articleHtml(n, related) {
  const isAyamonte = n.section === 'ayamonte';
  const sectionLabel = isAyamonte ? 'Noticias de Ayamonte' : 'Noticias comarcales';
  const sectionClass = isAyamonte ? 'kicker-ayamonte' : 'kicker-comarca';
  const fallback = `/assets/images/placeholder-${isAyamonte ? 'ayamonte' : 'comarca'}.svg`;
  
  const img = n.imageUrl
    ? `<figure class="article-hero media is-visible">
         <img src="${esc(n.imageUrl)}" alt="${esc(n.title)}" onerror="this.onerror=null;this.src='${fallback}'">
         ${n.imageSource ? `<figcaption>Fotografía / Fuente: ${esc(n.imageSource)}</figcaption>` : ''}
       </figure>`
    : `<figure class="article-hero media is-visible">
         <img src="${fallback}" alt="${esc(sectionLabel)}">
         <figcaption>Imagen editorial · ${esc(sectionLabel)}</figcaption>
       </figure>`;

  // Dividir texto en párrafos naturales
  const rawText = (n.bodyExcerpt || n.summary || '').trim();
  let rawParagraphs = rawText
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/)
    .map((p) => p.trim())
    .filter((p) => p.length > 20);

  if (!rawParagraphs.length && rawText) {
    rawParagraphs = [rawText];
  }

  const keyPoints = generateKeyPoints(n);
  const readTime = estimateReadTime(rawText + ' ' + (n.title || ''));

  const relatedHtml = related && related.length
    ? `<div class="article-related-section" style="margin-top:3.5rem;padding-top:2rem;border-top:2px solid var(--line);">
         <div class="block-head">
           <h2>Noticias relacionadas en ${esc(sectionLabel)}</h2>
           <a class="more" href="/seccion/${esc(n.section)}">Ver más noticias →</a>
         </div>
         <div class="card-grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.5rem;margin-top:1.2rem;">
           ${related.slice(0, 3).map(cardHtml).join('')}
         </div>
       </div>`
    : '';

  return `
    <article class="article-view">
      <div class="article-head">
        <nav class="breadcrumbs" aria-label="Navegación">
          <a href="/">Portada</a> <span class="sep">/</span>
          <a href="/seccion/${esc(n.section)}">${esc(sectionLabel)}</a>
        </nav>
        
        <div style="margin-bottom:.8rem;">
          <span class="kicker ${sectionClass}">${esc(sectionLabel)}</span>
        </div>

        <h1 class="article-headline">${esc(n.title)}</h1>

        ${n.summary ? `<p class="article-lead">${esc(n.summary)}</p>` : ''}

        <div class="article-meta-bar">
          <div class="meta-left">
            <span class="meta-author">Redacción Ayamonte.org</span>
            <span class="meta-sep">·</span>
            <span class="meta-source">Fuente: <strong>${esc(n.source || 'Agencias')}</strong></span>
            <span class="meta-sep">·</span>
            <time datetime="${esc(n.publishedAt || n.fetchedAt)}">${esc(fmtDate(n.publishedAt || n.fetchedAt))}</time>
          </div>
          <div class="meta-right">
            <span class="meta-pill"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${readTime}</span>
            ${n.views ? `<span class="meta-pill"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>${n.views} lecturas</span>` : ''}
            ${n.isDemo ? '<span class="demo-tag">Demostración</span>' : ''}
          </div>
        </div>
      </div>

      ${img}

      <div class="article-body">
        <!-- Bloque de claves / resumen informativo -->
        <section class="key-points-box" aria-label="Puntos clave">
          <h3 class="key-points-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-3px;margin-right:6px;"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            Claves de la noticia
          </h3>
          <ul class="key-points-list">
            ${keyPoints.map((pt) => `<li>${pt}</li>`).join('')}
          </ul>
        </section>

        <!-- Desarrollo de la información -->
        <div class="article-paragraphs">
          ${rawParagraphs.map((p, idx) => {
            if (idx === 1 && rawParagraphs.length > 2) {
              return `<p>${esc(p)}</p>
                <div class="article-callout">
                  <p><strong>Actualidad y seguimiento:</strong> Esta noticia forma parte de la cobertura continua de <em>Ayamonte.org</em> sobre los acontecimientos y decisiones que impactan en nuestro entorno municipal y comarcal.</p>
                </div>`;
            }
            return `<p>${esc(p)}</p>`;
          }).join('')}
        </div>

        <!-- Tarjeta de Cobertura Completa en la Fuente Original -->
        <section class="source-action-card">
          <div class="source-action-header">
            <span class="source-badge">Cobertura original</span>
            <h3>Artículo publicado en ${esc(n.source || 'medio oficial')}</h3>
          </div>
          <p class="source-action-text">
            Este contenido ha sido recopilado y estructurado de forma automatizada por el servicio informativo de <strong>Ayamonte.org</strong> para la cobertura local. Puedes leer el reportaje íntegro, declaraciones ampliadas y material multimedia en su publicación de origen.
          </p>
          <div class="source-action-btn-wrap">
            <a class="source-primary-btn" href="${esc(n.url)}" target="_blank" rel="noopener nofollow">
              <span>Leer la noticia completa en <strong>${esc(n.source || 'la fuente original')}</strong></span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
          </div>
        </section>
      </div>

      <!-- Barra para compartir -->
      <div class="article-share-section" style="max-width:760px;margin:2rem auto 0;">
        <div style="font-size:.85rem;font-weight:700;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.8rem;text-align:center;">Comparte esta noticia</div>
        ${buildShareBar(n)}
      </div>

      <!-- Etiquetas -->
      <div class="tag-bar" style="max-width:760px;margin:1.4rem auto 0;display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center;">
        <a class="share-btn" href="/seccion/${esc(n.section)}">#${esc(sectionLabel)}</a>
        ${(n.tags || []).map((t) => `<a class="share-btn" href="/noticias?q=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}
      </div>
    </article>

    ${relatedHtml}
  `;
}

async function loadComments(slug) {
  const list = document.getElementById('comments-list');
  if (!list) return;
  try {
    const items = await API.get('/api/comments?slug=' + encodeURIComponent(slug));
    if (!items || !items.length) {
      list.innerHTML = '<p style="color:var(--ink-mute);font-size:.9rem">Aún no hay comentarios. ¡Sé el primero!</p>';
      return;
    }
    list.innerHTML = items.map((c) => `
      <div style="border-bottom:1px solid var(--line);padding:.8rem 0">
        <div style="font-weight:700;font-size:.9rem">${esc(c.author)} <span style="font-weight:400;color:var(--ink-mute);font-size:.78rem">· ${esc(c.created_at)}</span></div>
        <div style="margin-top:.3rem;font-size:.92rem;line-height:1.5">${esc(c.content)}</div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = '<p style="color:var(--ink-mute);font-size:.9rem">No se pudieron cargar los comentarios.</p>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Delegación para el formulario de comentarios (se crea dinámicamente)
  document.addEventListener('submit', async (e) => {
    if (e.target && e.target.id === 'comment-form') {
      e.preventDefault();
      const slug = slugFromPath();
      const author = document.getElementById('c-author').value.trim();
      const content = document.getElementById('c-content').value.trim();
      const msg = document.getElementById('comment-msg');
      if (!author || !content) { msg.textContent = 'Completa nombre y comentario.'; msg.style.color = 'var(--accent-red)'; return; }
      try {
        await API.send('/api/comments', 'POST', { news_slug: slug, author, content });
        msg.textContent = 'Comentario enviado. Será publicado tras moderación.';
        msg.style.color = 'var(--success)';
        document.getElementById('comment-form').reset();
        // recargar comentarios (solo aprobados, así que no aparecerá hasta aprobar)
      } catch (err) {
        msg.textContent = 'Error: ' + err.message;
        msg.style.color = 'var(--accent-red)';
      }
    }
  });
});

async function initArticle() {
  const root = document.getElementById('article-root');
  if (!root) return;

  const slug = slugFromPath();
  if (!slug) {
    root.innerHTML = emptyHtml('Noticia no encontrada', 'Comprueba la dirección o vuelve a la portada.');
    return;
  }

  try {
    const data = await API.get(`/api/news/${encodeURIComponent(slug)}`);
    const n = data.news;
    const related = data.related || [];

    if (!n) throw new Error('No se encontraron datos para esta noticia.');

    document.title = `${n.title || 'Noticia'} — Ayamonte.org`;
    if (n.summary) {
      setMeta('name', 'description', n.summary.slice(0, 160));
      setMeta('property', 'og:description', n.summary.slice(0, 200));
    }
    setMeta('property', 'og:title', n.title || '');
    setMeta('property', 'og:type', 'article');
    setMeta('property', 'og:url', location.href);
    if (n.imageUrl) setMeta('property', 'og:image', n.imageUrl);

    // Structured data (JSON-LD) para Google
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: n.title || '',
      description: (n.summary || '').slice(0, 200),
      datePublished: n.publishedAt || n.fetchedAt || '',
      image: n.imageUrl || '',
      author: { '@type': 'Organization', name: n.source || 'Ayamonte.org' },
      publisher: { '@type': 'Organization', name: 'Ayamonte.org' }
    };
    let ldScript = document.getElementById('ld-json');
    if (!ldScript) {
      ldScript = document.createElement('script');
      ldScript.type = 'application/ld+json';
      ldScript.id = 'ld-json';
      document.head.appendChild(ldScript);
    }
    ldScript.textContent = JSON.stringify(ld);

    root.innerHTML = articleHtml(n, related);

    // Artículo completo (extraído de la fuente original)
    const fullBox = document.createElement('section');
    fullBox.className = 'full-article';
    fullBox.style.marginTop = '2rem';
    fullBox.innerHTML = '<h2 style="font-family:var(--serif);border-bottom:2px solid var(--accent);padding-bottom:.3rem">Artículo completo</h2><div id="full-content" style="margin-top:1rem;color:var(--ink-soft);line-height:1.7;white-space:pre-wrap;font-size:.95rem">Cargando artículo completo…</div><p style="margin-top:.8rem;font-size:.8rem;color:var(--ink-mute)">Fuente original: <a href="' + esc(n.url) + '" target="_blank" rel="noopener" style="color:var(--accent)">' + esc(n.source || n.url) + '</a></p>';
    root.appendChild(fullBox);

    // Cargar contenido completo desde Jina AI Reader
    if (n.url) {
      fetch('https://r.jina.ai/' + n.url)
        .then((r) => r.text())
        .then((text) => {
          const el = document.getElementById('full-content');
          if (!el) return;
          // Extraer solo el Markdown Content
          const idx = text.indexOf('Markdown Content:');
          let content = idx !== -1 ? text.slice(idx + 'Markdown Content:'.length).trim() : text.trim();
          // Limpiar líneas de navegación (Facebook, Twitter, etc.)
          // Extraer solo el cuerpo del art�culo: desde el primer encabezado #
          let hIdx = content.indexOf('# ' + (n.title || ''));
          if (hIdx === -1) hIdx = content.lastIndexOf('# ');
          if (hIdx !== -1) content = content.slice(hIdx);
const endMarkers = ['\n Etiquetas ', '\n Etiquetas\n', '\n Noticias de hoy', '\n Lo más', '\n Síguenos ', '\n Secciones '];
          let cut = content.length;
          for (const m of endMarkers) {
            const i = content.indexOf(m);
            if (i !== -1 && i < cut) cut = i;
          }
          content = content.slice(0, cut).trim();
          // Limpiar l�neas de navegaci�n (Facebook, Twitter, etc.)
          content = content.split('\n').filter((l) => !/^\s*\*\s*\[/.test(l) && !/^\s*_/.test(l) && !/^!\[/.test(l)).join('\n').trim();
          if (content.length < 50) {
            el.innerHTML = '<p style="color:var(--ink-mute)">No se pudo extraer el artículo completo. <a href="' + esc(n.url) + '" target="_blank" rel="noopener" style="color:var(--accent)">Leer en la fuente original →</a></p>';
          } else {
            el.innerHTML = content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
            el.innerHTML = '<p>' + el.innerHTML + '</p>';
          }
        })
        .catch(() => {
          const el = document.getElementById('full-content');
          if (el) el.innerHTML = '<p style="color:var(--ink-mute)">No se pudo cargar el artículo completo. <a href="' + esc(n.url) + '" target="_blank" rel="noopener" style="color:var(--accent)">Leer en la fuente original →</a></p>';
        });
    }
    
    // Sección de comentarios
    const commentsSection = document.createElement('section');
    commentsSection.className = 'comments-section';
    commentsSection.style.marginTop = '2rem';
    commentsSection.innerHTML = `
      <h2 style="font-family:var(--serif);border-bottom:2px solid var(--accent);padding-bottom:.3rem">Comentarios</h2>
      <div id="comments-list" style="margin-top:1rem">Cargando comentarios…</div>
      <form id="comment-form" style="margin-top:1.2rem;display:flex;flex-direction:column;gap:.6rem;max-width:600px">
        <div class="field"><label>Nombre</label><input type="text" id="c-author" required placeholder="Tu nombre"></div>
        <div class="field"><label>Comentario</label><textarea id="c-content" rows="3" required placeholder="Escribe tu comentario…"></textarea></div>
        <button class="btn-a accent" type="submit" style="align-self:flex-start">Enviar comentario</button>
      </form>
      <div id="comment-msg" style="margin-top:.6rem;font-size:.9rem"></div>
    `;
    root.appendChild(commentsSection);
    loadComments(slug);

    // Asegurar que todos los elementos sean visibles de inmediato
    root.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-visible'));
    if (typeof observeReveals === 'function') {
      observeReveals(root);
    }
  } catch (err) {
    console.error('Error cargando noticia:', err);
    root.innerHTML = `
      <div class="empty is-visible" style="max-width:600px;margin:3rem auto;text-align:center;">
        <h2 style="font-family:var(--serif);font-size:1.8rem;color:var(--ink);">No se pudo cargar la noticia</h2>
        <p style="color:var(--ink-soft);margin:1rem 0 1.5rem;">${esc(err.message)}</p>
        <a class="btn-a primary" href="/">← Volver a la portada</a>
      </div>
    `;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initArticle);
} else {
  initArticle();
}
