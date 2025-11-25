import React from 'react'
import ReactDOM from 'react-dom'

// Styles
import './app.css'

// Helper functions
import { removeTrackFromPlaylist } from './api'
import {
    getTrackUriToPlaylistData,
    updatePlaylistData,
    updateLikedTracks,
} from './playlist'

type PlaylistData = {
    image: string
    isLikedTracks: boolean
    isOwnPlaylist: boolean
    name: string
    trackUid: string
    uri: `spotify:track:${string}`
}

type TrackElement = Element

// Initialize variables - these are stored at the module level, so accessible to all functions in this file
let oldMainElement: HTMLElement | null = null
let mainElement: HTMLElement | null = null
let mainElementObserver: MutationObserver | null = null

/** Holds the current list of track DOM elements and updates as the UI changes.
 *  Why it's lists and not list: because the spotify CSS calls a track row a tracklist
 */
let tracklists: TrackElement[] = []
let oldTracklists: TrackElement[] = []
let trackUriToPlaylistData: Record<string, PlaylistData[]> = {}
let playlistUpdated = false
let showAllPlaylists = false
let highlightTrack: string | null = null
let highlightTrackPath: `/playlist/${string}` | string | null = null
let maxExistingLabelCount = 0
let maxLabelCount = 1
let rowHeight = '56px'
let mainView: HTMLElement | null = null
let updatePromise: Promise<any> = Promise.resolve()
function playlistUriToPlaylistId(uri: string): string | null {
    if (!uri) return null
    return uri.match(/spotify:playlist:(.*)/)?.[1] || null
}

/** Returns the track URI from a DOM-track list element
 */
// The DOM elements for tracks all have pendingProps (i.e. just the props), then we get the children and the children of that element
// then that element (or a child) has a prop called uri, which is the track URI (universal resource identifier)
// it's new to me that pendingProps is exposed this way in the DOM
// can't replicate it on stackBlitz (there pendingProps is a property of __reactFiber{randomString}) but w/e it's an implementation detail

function getTracklistTrackUri(tracklistElement: any): string | null {
    let values = Object.values(tracklistElement)
    if (!values) return null

    // Spotify keeps the URI in various places depending on whether the context is a playlist/album/liked songs
    // this selector works for most cases
    // instead of ts-ignore we could properly check for property access but that's very verbose and the ?. operator works just fine
    // @ts-ignore
    const searchFrom = values?.[0]?.pendingProps?.children?.[0]?.props?.children

    const uriNormalWay =
        searchFrom?.props?.uri ||
        searchFrom?.props?.children?.props?.uri ||
        searchFrom?.props?.children?.props?.children?.props?.uri ||
        searchFrom?.[0]?.props?.uri

    if (uriNormalWay) {
        return uriNormalWay
    } else {
        // this selector doesn't for albums/liked songs-playlist, but seemingly only for custom playlists
        let customPlaylistTrackUri =
            // instead of ts-ignore we could properly check for property access but that's very verbose and the ?. operator works just fine
            // @ts-ignore
            values?.[0]?.pendingProps?.children?.props?.value?.item?.uri
        return customPlaylistTrackUri
    }
}
/** Sets a CSS variable, based on the global maxLabelCount
 *  the variable in turn defines the max-width of the labels container
 */
function calculateMaxLabelCount() {
    if (!mainView) return

    let newMaxLabelCount = maxLabelCount
    let space = rowHeight == '56px' ? 44 : 32
    let maxPossibleLabelCount = 20
    const minViewSize = 516
    const contentRect = mainView.getBoundingClientRect()

    let min = 0
    let max = minViewSize
    if (min <= contentRect.width && contentRect.width <= max) {
        newMaxLabelCount = 1
    }

    for (let i = 1; i < maxPossibleLabelCount - 1; i++) {
        min = minViewSize + 1 + space * (i - 1)
        max = minViewSize + 1 + space * i
        if (min <= contentRect.width && contentRect.width <= max) {
            newMaxLabelCount = i + 1
        }
    }

    min = minViewSize + 1 + space * (maxPossibleLabelCount - 2)
    if (min <= contentRect.width) {
        newMaxLabelCount = maxPossibleLabelCount
    }

    if (newMaxLabelCount !== maxLabelCount) {
        maxLabelCount = newMaxLabelCount
        document.documentElement.style.setProperty(
            '--spicetify-playlist-labels-max-label-count',
            `${maxLabelCount}`,
        )
        playlistUpdated = true
        updateTracklist()
    }
}

function updateTracklist() {
    oldTracklists = tracklists
    tracklists = Array.from(
        document.querySelectorAll('.main-trackList-indexable'),
    )

    if (
        oldTracklists.length !== tracklists.length ||
        !oldTracklists.every((value, index) => value === tracklists[index])
    ) {
        maxExistingLabelCount = 0
    }

    for (const tracklist of tracklists) {
        const tracks = tracklist.getElementsByClassName(
            'main-trackList-trackListRow',
        )
        for (const track of tracks) {
            const trackStyle = getComputedStyle(track)
            const trackRowHeight = trackStyle.getPropertyValue('--row-height')
            if (trackRowHeight != rowHeight) {
                rowHeight = trackRowHeight
                document.documentElement.style.setProperty(
                    '--spicetify-playlist-labels-size',
                    `calc(${rowHeight} * 0.5)`,
                )
                calculateMaxLabelCount()
                playlistUpdated = true
            }

            const trackUri = getTracklistTrackUri(track)

            // If no trackUri is found, skip this track
            if (!trackUri) continue

            if (
                highlightTrack === trackUri &&
                Spicetify.Platform.History.location.pathname ===
                    highlightTrackPath
            ) {
                // can't quite figure out why we're clicking the track in a function
                // that's called when the tracklist might be updated
                // also, type conversion needed - when we ask the browser for elements (getElementsByClassName) that returns elements
                // but we know React put it there so we can cast it to a React element
                const trackAsReactElement =
                    track as unknown as React.ElementType
                // not sure why a React.ElementType can never have a click method
                // @ts-ignore
                trackAsReactElement.click && trackAsReactElement.click()
                highlightTrack = null
            }

            let filteredPlaylistData = (
                trackUriToPlaylistData[trackUri] ?? []
            ).filter((playlistData) => {
                if (!showAllPlaylists && !playlistData.isOwnPlaylist)
                    return false

                if (!playlistData.isLikedTracks) {
                    const playlistId = playlistUriToPlaylistId(playlistData.uri)
                    if (
                        Spicetify.Platform.History.location.pathname ===
                        `/playlist/${playlistId}`
                    )
                        return false
                } else if (
                    Spicetify.Platform.History.location.pathname ===
                    '/collection/tracks'
                ) {
                    return false
                }

                return true
            })

            if (filteredPlaylistData.length > maxExistingLabelCount) {
                maxExistingLabelCount = filteredPlaylistData.length
                document.documentElement.style.setProperty(
                    '--spicetify-playlist-labels-label-count',
                    `${maxExistingLabelCount}`,
                )
            }

            let labelContainer = track.querySelector(
                '.spicetify-playlist-labels',
            )

            if (playlistUpdated) {
                if (labelContainer) {
                    labelContainer.remove()
                    labelContainer = null
                }
            }

            if (!labelContainer) {
                // Add column for labels
                let lastColumn = track.querySelector(
                    '.main-trackList-rowSectionEnd',
                )
                labelContainer = document.createElement('div')
                labelContainer.classList.add('spicetify-playlist-labels')

                let containerClassName =
                    'spicetify-playlist-labels-labels-container'

                if (filteredPlaylistData.length > maxLabelCount) {
                    containerClassName += ' spicetify-playlist-labels-overflow'
                }

                filteredPlaylistData = filteredPlaylistData.slice(
                    0,
                    maxLabelCount,
                )

                ReactDOM.render(
                    <div className={containerClassName}>
                        {filteredPlaylistData.map((playlistData) => {
                            if (
                                !showAllPlaylists &&
                                !playlistData.isOwnPlaylist
                            )
                                return null

                            if (!playlistData.isLikedTracks) {
                                const playlistId = playlistUriToPlaylistId(
                                    playlistData.uri,
                                )
                                if (
                                    Spicetify.Platform.History.location
                                        .pathname === `/playlist/${playlistId}`
                                )
                                    return null
                            } else if (
                                Spicetify.Platform.History.location.pathname ===
                                '/collection/tracks'
                            ) {
                                return null
                            }

                            return (
                                <Spicetify.ReactComponent.TooltipWrapper
                                    label={playlistData.name}
                                    placement="top"
                                >
                                    <div>
                                        <Spicetify.ReactComponent.RightClickMenu
                                            placement="bottom-end"
                                            menu={
                                                playlistData.isLikedTracks ? null : (
                                                    <Spicetify.ReactComponent.Menu>
                                                        <Spicetify.ReactComponent.MenuItem
                                                            leadingIcon={
                                                                <Spicetify.ReactComponent.IconComponent
                                                                    dangerouslySetInnerHTML={{
                                                                        __html: '<path d="M5.25 3v-.917C5.25.933 6.183 0 7.333 0h1.334c1.15 0 2.083.933 2.083 2.083V3h4.75v1.5h-.972l-1.257 9.544A2.25 2.25 0 0 1 11.041 16H4.96a2.25 2.25 0 0 1-2.23-1.956L1.472 4.5H.5V3h4.75zm1.5-.917V3h2.5v-.917a.583.583 0 0 0-.583-.583H7.333a.583.583 0 0 0-.583.583zM2.986 4.5l1.23 9.348a.75.75 0 0 0 .744.652h6.08a.75.75 0 0 0 .744-.652L13.015 4.5H2.985z"></path>',
                                                                    }}
                                                                    iconSize={
                                                                        16
                                                                    }
                                                                    style={{
                                                                        color: 'var(--text-subdued)',
                                                                    }}
                                                                />
                                                            }
                                                            onClick={(
                                                                e: Event,
                                                            ) => {
                                                                e.stopPropagation()
                                                                removeTrackFromPlaylist(
                                                                    playlistData.uri,
                                                                    trackUri,
                                                                )
                                                                trackUriToPlaylistData[
                                                                    trackUri
                                                                ] =
                                                                    trackUriToPlaylistData[
                                                                        trackUri
                                                                    ].filter(
                                                                        (
                                                                            otherPlaylistData,
                                                                        ) =>
                                                                            otherPlaylistData.uri !==
                                                                            playlistData.uri,
                                                                    )
                                                                playlistUpdated =
                                                                    true
                                                                updateTracklist()
                                                            }}
                                                        >
                                                            Remove from{' '}
                                                            {playlistData.name}
                                                        </Spicetify.ReactComponent.MenuItem>
                                                    </Spicetify.ReactComponent.Menu>
                                                )
                                            }
                                        >
                                            <div
                                                className="spicetify-playlist-labels-label-container"
                                                style={{
                                                    cursor: 'pointer',
                                                }}
                                                onClick={(
                                                    e: React.MouseEvent,
                                                ) => {
                                                    e.stopPropagation()
                                                    const path =
                                                        playlistData.isLikedTracks
                                                            ? '/collection/tracks'
                                                            : Spicetify.URI.fromString(
                                                                  playlistData.uri,
                                                              )?.toURLPath(true)
                                                    highlightTrack = trackUri
                                                    highlightTrackPath = path
                                                    if (path)
                                                        Spicetify.Platform.History.push(
                                                            {
                                                                pathname: path,
                                                                search: `?uid=${playlistData.trackUid}`,
                                                            },
                                                        )
                                                }}
                                            >
                                                <img src={playlistData.image} />
                                            </div>
                                        </Spicetify.ReactComponent.RightClickMenu>
                                    </div>
                                </Spicetify.ReactComponent.TooltipWrapper>
                            )
                        })}
                    </div>,
                    labelContainer,
                )

                lastColumn &&
                    lastColumn.insertBefore(
                        labelContainer,
                        lastColumn.firstChild,
                    )
            }
        }

        playlistUpdated = false
    }
}

async function observerCallback() {
    oldMainElement = mainElement
    mainElement = document.querySelector('main')
    if (mainElement && !mainElement.isEqualNode(oldMainElement)) {
        if (oldMainElement) {
            mainElementObserver && mainElementObserver.disconnect()
        }
        updateTracklist()
        mainElementObserver &&
            mainElementObserver.observe(mainElement, {
                childList: true,
                subtree: true,
            })
    }
}

async function main() {
    while (!Spicetify?.showNotification) {
        await new Promise((resolve) => setTimeout(resolve, 100))
    }

    mainView = document.querySelector('.Root__main-view')

    showAllPlaylists = await JSON.parse(
        localStorage.getItem('spicetify-playlist-labels:show-all') || 'false',
    )

    // We could provide an actual type instead of any
    const getDataAndUpdateTracklist = (promise: Promise<any>) => {
        promise.then((data) => {
            trackUriToPlaylistData = data
            playlistUpdated = true
            updateTracklist()
        })
    }

    await Spicetify.Platform.LibraryAPI.getEvents().addListener(
        'update',
        () => {
            updatePromise = updatePromise.then(() => {
                return updateLikedTracks()
            })
            getDataAndUpdateTracklist(updatePromise)
        },
    )

    await Spicetify.Platform.PlaylistAPI.getEvents().addListener(
        'operation_complete',

        // A custom Spicetify event, no type provided in spicetify.d.ts so easiest to just do 'any'
        (event: any) => {
            updatePromise = updatePromise.then(() => {
                return updatePlaylistData(event.data.uri)
            })
            getDataAndUpdateTracklist(updatePromise)
        },
    )

    const handleButtonClick = (buttonElement: Spicetify.Playbar.Button) => {
        buttonElement.active = showAllPlaylists = !buttonElement.active
        localStorage.setItem(
            'spicetify-playlist-labels:show-all',
            JSON.stringify(showAllPlaylists),
        )
        playlistUpdated = true
        updateTracklist()
    }

    // create the playbar toggle button
    const iconHTML = `<svg data-encore-id="icon" role="img" viewBox="0 0 16 16" class="Svg-img-icon-small">${Spicetify.SVGIcons['spotify']}</svg>`
    const showAllPlaylistsButton = new Spicetify.Playbar.Button(
        'Show All Saved Playlists',
        iconHTML,
        handleButtonClick,
        false,
        showAllPlaylists,
    )

    trackUriToPlaylistData = await getTrackUriToPlaylistData()

    mainElementObserver = new MutationObserver(() => {
        updateTracklist()
    })

    const observer = new MutationObserver(async () => {
        await observerCallback()
    })
    await observerCallback()
    observer.observe(document.body, {
        childList: true,
        subtree: true,
    })

    const resizeObserver = new ResizeObserver((entries) => {
        calculateMaxLabelCount()
    })

    mainView && resizeObserver.observe(mainView)
}

export default main
