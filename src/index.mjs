import { ObservableV2 } from 'lib0/observable'
import {
  toBase64,
  fromBase64
} from 'lib0/buffer'
import * as yjs from 'yjs'
import {
  NOSTR_CRDT_EVENT_TYPE
} from './magic.mjs'
import {
  NDKEvent
} from '@nostr-dev-kit/ndk'
import {
  arrayBuffersAreEqual,
  snapshotContainsAllDeletes
} from './util.mjs'

export async function createNostrCRDTRoom (
  ndk,
  label,
  initialLocalState
) {
  return new Promise((resolve) => {
    const sub = ndk.subscribe({
      since: Math.floor(Date.now() / 1000) - 1,
      kinds: [NOSTR_CRDT_EVENT_TYPE]
    }, {
      closeOnEose: false
    })
    sub.on('event', (event) => {
      resolve(event.id)
    })
    const ndkEvent = new NDKEvent(ndk)
    ndkEvent.created_at = Math.floor(Date.now() / 1000)
    ndkEvent.kind = NOSTR_CRDT_EVENT_TYPE
    ndkEvent.content = toBase64(initialLocalState)
    ndkEvent.tags = [['crdt', label]]
    ndk.publish(ndkEvent)
  })
}
export class NostrProvider extends ObservableV2 {
  constructor (
    ydoc,
    nostrRoomCreateEventId,
    ndk,
    publicKey
  ) {
    super()
    this.ydoc = ydoc
    this.ndk = ndk
    this.nostrRoomCreateEventId = nostrRoomCreateEventId
    this.ydoc.on('update', this.documentUpdateListener)
    this.publicKey = publicKey
  }

  updateFromEvents (events) {
    // Create a yjs update from the events
    const updates = events.map((e) => new Uint8Array(fromBase64(e.content)))
    const update = yjs.mergeUpdates(updates)
    return update
  }

  publishUpdate (update) {
    const ndkEvent = new NDKEvent(this.ndk)
    ndkEvent.kind = NOSTR_CRDT_EVENT_TYPE
    ndkEvent.created_at = Math.floor(Date.now() / 1000)
    ndkEvent.content = toBase64(update)
    ndkEvent.tags = [
      ['e', this.nostrRoomCreateEventId]
    ]
    this.ndk.publish(ndkEvent)
  }

  pendingUpdates = []
  sendPendingTimeout

  async documentUpdateListener (update, origin) {
    if (origin === this) {
      return
    }
    if (origin?.provider) {
      return
    }
    this?.pendingUpdates.push(update)

    if (this?.sendPendingTimeout) {
      clearTimeout(this.sendPendingTimeout)
    }

    // buffer every 100ms
    if (this === undefined) {
      return
    }
    this.sendPendingTimeout = setTimeout(() => {
      this.publishUpdate(yjs.mergeUpdates(this.pendingUpdates))
      this.pendingUpdates = []
    }, 100)
  }

  /**
  * Handles incoming events from nostr
  */
  processIncomingEvents = (events) => {
    const update = this.updateFromEvents(events)
    yjs.applyUpdate(this.ydoc, update, this)
  }

  async initialize () {
    try {
      let eoseSeen = false
      const initialEvents = []
      const sub = this.ndk.subscribe([
        {
          ids: [this.nostrRoomCreateEventId],
          kinds: [NOSTR_CRDT_EVENT_TYPE]
          //,
          // limit: 1,
          // since: 0
        },
        {
          '#e': [this.nostrRoomCreateEventId],
          kinds: [NOSTR_CRDT_EVENT_TYPE]
        }
      ])
      sub.on('event', (e) => {
        if (!eoseSeen) {
          initialEvents.push(e)
        } else {
          this.processIncomingEvents([e])
        }
      })
      sub.on('eose', () => {
        eoseSeen = true
        const initialLocalState = yjs.encodeStateAsUpdate(this.ydoc)
        const initialLocalStateVector = yjs.encodeStateVectorFromUpdate(initialLocalState)
        const deleteSetOnlyUpdate = yjs.diffUpdate(
          initialLocalState,
          initialLocalStateVector
        )
        const oldSnapshot = yjs.snapshot(this.ydoc)
        // This can fail because of no access to room. Because the room history should always be available,
        // we don't catch this event here
        const update = this.updateFromEvents(initialEvents)
        yjs.applyUpdate(this.ydoc, update, this)
        // this.emit('documentAvailable')
        // Next, find if there are local changes that haven't been synced to the server
        const remoteStateVector = yjs.encodeStateVectorFromUpdate(update)
        const missingOnWire = yjs.diffUpdate(
          initialLocalState,
          remoteStateVector
        )
        // missingOnWire will always contain the entire deleteSet on startup.
        // Unfortunately diffUpdate doesn't work well with deletes. In the if-statement
        // below, we try to detect when missingOnWire only contains the deleteSet, with
        // deletes that already exist on the wire
        if (
          arrayBuffersAreEqual(
            deleteSetOnlyUpdate.buffer,
            missingOnWire.buffer
          )
        ) {
          // TODO: instead of next 3 lines, we can probably get deleteSet directly from 'update'
          const serverDoc = new yjs.Doc()
          yjs.applyUpdate(serverDoc, update)
          const serverSnapshot = yjs.snapshot(serverDoc)
          // TODO: could also compare whether snapshot equal? instead of snapshotContainsAllDeletes?
          if (snapshotContainsAllDeletes(serverSnapshot, oldSnapshot)) {
            // missingOnWire only contains a deleteSet with items that are already in the deleteSet on server
          }
        }
        if (missingOnWire.length > 2) {
          this.publishUpdate(missingOnWire)
        }
      })
    } catch (e) {
      console.error(e)
    }
  }
}