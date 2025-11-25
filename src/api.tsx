export async function getContents() {
    return await Spicetify.Platform.RootlistAPI.getContents({
        decorateImagesAndOwner: true,
    })
}

export async function getLikedTracksCount() {
    return (await Spicetify.Platform.LibraryAPI.getTracks()).totalLength
}

export async function getPlaylistItems(uri: string) {
    // Sometimes Spicetify throws an error here despite a seemingly valid URI, best to catch that
    try {
        const result = await Spicetify.Platform.PlaylistAPI.getContents(uri)
        return result.items
    } catch {
        return null
    }
}

export async function removeTrackFromPlaylist(playlistUri, trackUri) {
    await Spicetify.Platform.PlaylistAPI.remove(playlistUri, [
        { uri: trackUri, uid: '' },
    ])
}

export async function getLikedTracks() {
    return await Spicetify.Platform.LibraryAPI.getTracks({
        limit: Number.MAX_SAFE_INTEGER,
    })
}
