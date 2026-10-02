/**
 * Extension d'exemple : ajoute TVmaze comme source de métadonnées pour les séries.
 *
 * Elle ne modifie rien dans EpiKodi : elle s'enregistre via l'API remise à `activate()`, et
 * l'application l'interroge ensuite exactement comme TheMovieDB. TVmaze est public et ne demande
 * aucune clé, ce qui en fait un bon cas de démonstration.
 */

const API = 'https://api.tvmaze.com'

/** Les résumés TVmaze contiennent du HTML ; on le réduit à du texte lisible. */
function texteBrut(html) {
  if (!html) return null
  const texte = String(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
  return texte || null
}

function versFiche(show) {
  return {
    externalId: String(show.id),
    kind: 'tv',
    title: show.name,
    originalTitle: null,
    year: show.premiered ? Number(show.premiered.slice(0, 4)) : null,
    overview: texteBrut(show.summary),
    rating: show.rating && show.rating.average ? show.rating.average : null,
    posterUrl: show.image ? (show.image.original ?? show.image.medium) : null,
    backdropUrl: null,
    genres: show.genres ?? [],
    runtime: show.averageRuntime ?? show.runtime ?? null
  }
}

exports.activate = (api) => {
  api.registerMetadataProvider({
    id: 'tvmaze',
    name: 'TVmaze',

    async search({ title }) {
      const reponse = await api.fetch(`${API}/search/shows?q=${encodeURIComponent(title)}`)
      if (!reponse.ok) throw new Error(`TVmaze a répondu ${reponse.status}`)
      const resultats = await reponse.json()
      return resultats.slice(0, 10).map((r) => versFiche(r.show))
    },

    async details(externalId) {
      const reponse = await api.fetch(`${API}/shows/${externalId}?embed=cast`)
      if (!reponse.ok) return null
      const show = await reponse.json()
      const fiche = versFiche(show)
      const distribution = (show._embedded && show._embedded.cast) || []
      fiche.cast = distribution.slice(0, 8).map((r) => r.person.name)
      return fiche
    }
  })

  // Démonstration des hooks : l'extension est prévenue de ce qui entre en bibliothèque
  api.on('media:scanned', (media) => {
    if (media && media.type === 'video') api.log(`vu passer : ${media.title}`)
  })

  api.log('prêt — TVmaze enregistré comme source de métadonnées')
}

exports.deactivate = () => {
  // Rien à libérer ici : ni minuterie, ni fichier ouvert.
}
