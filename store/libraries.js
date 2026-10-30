import VueRouter from 'vue-router'
import { bookshelfTabs, planViewSwitch, recordTab, restoreTab } from '@/utils/libraryViewState'
const { BookCoverAspectRatio } = require('../plugins/constants')

export const state = () => ({
  libraries: [],
  lastLoad: 0,
  currentLibraryId: '',
  showModal: false,
  issues: 0,
  filterData: null,
  numUserPlaylists: 0,
  ereaderDevices: [],
  viewState: { owner: null, libraries: {} },
  viewStateLoaded: false,
  switching: false,
  tabRecordingSuspended: false,
  // Once per process: the start-up library has opened on its remembered tab (or the chance has passed)
  startupTabRestored: false,
  startupRestorePending: false
})

// Duplicate, cancelled and redirected navigations are expected while pages react to library-changed
async function replaceRoute(router, path) {
  try {
    await router.replace(path)
  } catch (error) {
    if (!VueRouter.isNavigationFailure(error)) console.error('[libraries] Navigation failed', path, error)
  }
}

export const getters = {
  getCurrentLibrary: state => {
    return state.libraries.find(lib => lib.id === state.currentLibraryId)
  },
  getCurrentLibraryName: (state, getters) => {
    return getters.getCurrentLibrary?.name || null
  },
  getCurrentLibraryMediaType: (state, getters) => {
    return getters.getCurrentLibrary?.mediaType || null
  },
  getCurrentLibrarySettings: (state, getters) => {
    return getters.getCurrentLibrary?.settings || null
  },
  getBookCoverAspectRatio: (state, getters) => {
    if (isNaN(getters.getCurrentLibrarySettings?.coverAspectRatio)) return 1
    return getters.getCurrentLibrarySettings.coverAspectRatio === BookCoverAspectRatio.STANDARD ? 1.6 : 1
  },
  getLibraryIsAudiobooksOnly: (state, getters) => {
    return !!getters.getCurrentLibrarySettings?.audiobooksOnly
  },
  getBookshelfTabs: (state, getters, rootState, rootGetters) => {
    return bookshelfTabs({ mediaType: getters.getCurrentLibraryMediaType, hasPlaylists: !!state.numUserPlaylists, isAdmin: !!rootGetters['user/getIsAdminOrUp'] })
  }
}

export const actions = {
  fetch({ state, commit, dispatch, rootState }, libraryId) {
    if (!rootState.user || !rootState.user.user) {
      console.error('libraries/fetch - User not set')
      return false
    }

    return this.$nativeHttp
      .get(`/api/libraries/${libraryId}?include=filterdata`)
      .then(async (data) => {
        const library = data.library
        const filterData = data.filterdata
        const issues = data.issues || 0
        const numUserPlaylists = data.numUserPlaylists || 0

        if (state.viewStateLoaded) {
          const plan = planViewSwitch(state.viewState, libraryId, rootState.user.settings)
          if (plan.settingsUpdate) await dispatch('user/updateUserSettings', plan.settingsUpdate, { root: true })
          if (plan.state !== state.viewState) {
            commit('setViewState', plan.state)
            dispatch('saveViewState')
          }
        }
        dispatch('user/checkUpdateLibrarySortFilter', library.mediaType, { root: true })

        commit('addUpdate', library)
        commit('setLibraryIssues', issues)
        commit('setLibraryFilterData', filterData)
        commit('setNumUserPlaylists', numUserPlaylists)
        commit('setCurrentLibrary', libraryId)
        // A library chosen outside start-up (e.g. by opening a book) gets no start-up restore but its tabs are remembered
        if (!state.startupRestorePending) commit('setStartupTabRestored', true)
        return data
      })
      .catch((error) => {
        console.error('Failed', error)
        return false
      })
  },
  // Return true if calling load
  load({ state, commit, rootState }) {
    if (!rootState.user || !rootState.user.user) {
      console.error('libraries/load - User not set')
      return false
    }

    // Don't load again if already loaded in the last 5 minutes
    var lastLoadDiff = Date.now() - state.lastLoad
    if (lastLoadDiff < 5 * 60 * 1000) {
      // Already up to date
      return false
    }

    return this.$nativeHttp
      .get(`/api/libraries`)
      .then((data) => {
        // TODO: Server release 2.2.9 changed response to an object. Remove after a few releases
        const libraries = data.libraries || data

        // Set current library if not already set or was not returned in results
        if (libraries.length && (!state.currentLibraryId || !libraries.find(li => li.id == state.currentLibraryId))) {
          commit('setCurrentLibrary', libraries[0].id)
        }

        commit('set', libraries)
        commit('setLastLoad', Date.now())
        return true
      })
      .catch((error) => {
        console.error('Failed', error)
        commit('set', [])
        return false
      })
  },
  // Switch from the library button or the libraries menu: opens the library on its remembered tab
  async switchLibrary({ state, getters, commit, dispatch }, libraryId) {
    if (state.switching) return false
    commit('setSwitching', true)
    // Pages redirect on library-changed; those intermediate routes must not be remembered for the new library
    commit('setTabRecordingSuspended', true)
    try {
      if (!(await dispatch('fetch', libraryId))) return false
      // After the fetch: the available tabs depend on the new library's playlists
      const target = restoreTab(state.viewState, libraryId, getters.getBookshelfTabs)
      this.$eventBus.$emit('library-changed', libraryId)
      this.$localStore.setLastLibraryId(libraryId)
      await replaceRoute(this.$router, target)
      commit('setTabRecordingSuspended', false)
      dispatch('rememberTab', this.$router.currentRoute.name)
      return true
    } finally {
      commit('setTabRecordingSuspended', false)
      commit('setSwitching', false)
    }
  },
  async openRememberedTab({ state, getters }) {
    const target = restoreTab(state.viewState, state.currentLibraryId, getters.getBookshelfTabs)
    if (target !== '/bookshelf') await replaceRoute(this.$router, target)
  },
  rememberTab({ state, commit, dispatch }, routeName) {
    if (!state.viewStateLoaded || !state.currentLibraryId) return
    const next = recordTab(state.viewState, state.currentLibraryId, routeName)
    if (!next) return
    commit('setViewState', next)
    dispatch('saveViewState')
  },
  async loadViewState({ commit }) {
    commit('setViewState', await this.$localStore.getLibraryViewState())
    commit('setViewStateLoaded', true)
  },
  // Writes only after loading, so an early write can never overwrite the saved memory
  async saveViewState({ state }) {
    if (!state.viewStateLoaded) return
    await this.$localStore.setLibraryViewState(state.viewState)
  }
}

export const mutations = {
  setShowModal(state, val) {
    state.showModal = val
  },
  setLastLoad(state, val) {
    state.lastLoad = val
  },
  reset(state) {
    state.lastLoad = 0
    state.currentLibraryId = null
    state.libraries = []
  },
  setCurrentLibrary(state, val) {
    state.currentLibraryId = val
  },
  set(state, libraries) {
    state.libraries = libraries
  },
  addUpdate(state, library) {
    var index = state.libraries.findIndex(a => a.id === library.id)
    if (index >= 0) {
      state.libraries.splice(index, 1, library)
    } else {
      state.libraries.push(library)
    }
  },
  remove(state, library) {
    state.libraries = state.libraries.filter(a => a.id !== library.id)
  },
  setLibraryIssues(state, val) {
    state.issues = val
  },
  setNumUserPlaylists(state, numUserPlaylists) {
    state.numUserPlaylists = numUserPlaylists
  },
  setLibraryFilterData(state, filterData) {
    state.filterData = filterData
  },
  updateFilterDataWithAudiobook(state, audiobook) {
    if (!audiobook || !audiobook.book || !state.filterData) return
    if (state.currentLibraryId !== audiobook.libraryId) return
    /*
    var filterdata = {
      authors: [],
      genres: [],
      tags: [],
      series: [],
      narrators: []
    }
    */

    if (audiobook.book.authorFL) {
      audiobook.book.authorFL.split(', ').forEach((author) => {
        if (author && !state.filterData.authors.includes(author)) {
          state.filterData.authors.push(author)
        }
      })
    }
    if (audiobook.book.narratorFL) {
      audiobook.book.narratorFL.split(', ').forEach((narrator) => {
        if (narrator && !state.filterData.narrators.includes(narrator)) {
          state.filterData.narrators.push(narrator)
        }
      })
    }
    if (audiobook.book.series && !state.filterData.series.includes(audiobook.book.series)) {
      state.filterData.series.push(audiobook.book.series)
    }
    if (audiobook.tags && audiobook.tags.length) {
      audiobook.tags.forEach((tag) => {
        if (tag && !state.filterData.tags.includes(tag)) state.filterData.tags.push(tag)
      })
    }
    if (audiobook.book.genres && audiobook.book.genres.length) {
      audiobook.book.genres.forEach((genre) => {
        if (genre && !state.filterData.genres.includes(genre)) state.filterData.genres.push(genre)
      })
    }
  },
  setEReaderDevices(state, ereaderDevices) {
    state.ereaderDevices = ereaderDevices
  },
  setViewState(state, viewState) {
    state.viewState = viewState
  },
  setViewStateLoaded(state, val) {
    state.viewStateLoaded = val
  },
  setSwitching(state, val) {
    state.switching = val
  },
  setTabRecordingSuspended(state, val) {
    state.tabRecordingSuspended = val
  },
  setStartupTabRestored(state, val) {
    state.startupTabRestored = val
  },
  setStartupRestorePending(state, val) {
    state.startupRestorePending = val
  }
}