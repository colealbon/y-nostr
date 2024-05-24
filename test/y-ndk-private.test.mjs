import * as testing from 'lib0/testing'
import { WebSocket } from 'ws'
import * as yjs from 'yjs'
import NDK, {
  NDKPrivateKeySigner
} from '@nostr-dev-kit/ndk'
import {
  NostrProvider,
  createNostrCRDTRoom
} from '../src/y-ndk.mjs'
import { NostrRelay } from './NostrRelay.mjs'
import {
  YJS_UPDATE_EVENT_KIND
} from './magic.mjs'
import chloride from 'chloride'

global.WebSocket = WebSocket
const nostrRelay = new NostrRelay(9003)
const TEST_NOSTR_RELAYS = ['ws://localhost:9003']
if (!nostrRelay) {
  console.log('no relay')
}

export const testAlwaysPass = async tc => {
  testing.compare(true, true, 'objects are equal')
}

export const testSyncMapPrivate = async tc => {
  const keypair = chloride.crypto_box_keypair
  const alice = await keypair()
  const bob = await keypair()
  const subscribers = [alice, bob].map(subscriber => subscriber.publicKey)
  const aliceOpts = {}
  const aliceYdoc = new yjs.Doc()
  aliceOpts.explicitRelayUrls = TEST_NOSTR_RELAYS
  const alicePrivateKey = 'd334d0ddf781a958b410f6f079c0cccde0f6d76badcb043bf522ec2bc77c961b'
  const aliceSigner = new NDKPrivateKeySigner(alicePrivateKey)
  const alicePubkey = (await aliceSigner.user()).pubkey
  aliceOpts.signer = aliceSigner
  aliceOpts.activeUser = aliceSigner.user()
  const aliceNdk = new NDK(aliceOpts)
  await aliceNdk.connect()
  const initialLocalStateAlice = yjs.encodeStateAsUpdate(new yjs.Doc())
  const nostrRoomId = await createNostrCRDTRoom(
    aliceNdk,
    'testSyncYjsMap',
    initialLocalStateAlice,
    YJS_UPDATE_EVENT_KIND,
    subscribers,
    alice.secretKey
  )

  const nostrProviderAlice = new NostrProvider(
    aliceYdoc,
    nostrRoomId,
    aliceNdk,
    alicePubkey,
    YJS_UPDATE_EVENT_KIND,
    subscribers,
    alice.secretKey
  )
  nostrProviderAlice.initialize()
  const bobPrivateKey = '8bcdee1f90629b662c6347cb580665a884f89bfa23e38bb352b9d1a23301c0ca'
  const bobSigner = new NDKPrivateKeySigner(bobPrivateKey)
  const bobPubkey = (await bobSigner.user()).pubkey
  const bobOpts = {}
  bobOpts.signer = bobSigner
  bobOpts.activeUser = bobSigner.user()
  bobOpts.explicitRelayUrls = TEST_NOSTR_RELAYS
  const bobNdk = new NDK(bobOpts)
  await bobNdk.connect()
  const bobYdoc = new yjs.Doc()
  const nostrProviderBob = new NostrProvider(
    bobYdoc,
    nostrRoomId,
    bobNdk,
    bobPubkey,
    YJS_UPDATE_EVENT_KIND,
    subscribers,
    bob.secretKey
  )
  nostrProviderBob.initialize()
  aliceYdoc.getMap('test').set('contents', new yjs.Text('hello'))
  await new Promise((resolve) => setTimeout(resolve, 500))
  const bobReceive = bobYdoc.getMap('test').get('contents')?.toJSON()
  testing.compare(bobReceive, 'hello', 'objects are equal')
}