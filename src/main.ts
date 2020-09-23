import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
const ScryptaCore = require('@scrypta/core')
require('dotenv').config()
const scrypta = new ScryptaCore
scrypta.staticnodes = true
import * as PouchDB from 'pouchdb'
import { scrypt, sign } from 'crypto'
PouchDB.plugin(require('pouchdb-find'))
const fs = require('fs')
let Parser = require('rss-parser')
let isParsing = false
var LZUTF8 = require('lzutf8')

async function bootstrap() {
  if (process.env.MAIN_SID !== undefined) {

    /** CHECK MAIN IDENTITY */
    let xsid = await scrypta.readxKey(process.env.MAIN_PWD, process.env.MAIN_SID)
    if (xsid !== false) {
      /** INIT DATABASE */
      try {
        fs.open('INIT', 'r', function (err, fd) {
          if (err) {
            const db = new PouchDB('wp-news')
            db.createIndex({
              index: { fields: ['name', 'hash', 'email'] }
            })
            fs.writeFileSync('INIT', new Date().getTime())
          }
        })
      } catch (e) {
        console.log(e)
      }
      /** RUNNING NESTJS */
      const app = await NestFactory.create(AppModule)
      await app.listen(3000)

      /** RUNNING PARSER PROCESS */
      parse()
      setInterval(function () {
        parse()
      }, 60000)
    } else {
      console.log('UNABLE TO READ MAIN SID, WRONG PASSWORD.')
    }
  } else {
    console.log('MAIN xSID NOT FOUND, PLEASE ADD IT INTO YOUR .env FILE')
  }
}

async function parse() {
  if (!isParsing) {
    isParsing = true
    try {

      let parser = new Parser()
      let id = await scrypta.createAddress('123456', false)
      let request = await scrypta.createContractRequest(id.walletstore, '123456', { contract: 'Le9G4AYSGbGqonH7QEjFHDeVAMSPxK9KWt', function: 'index', params: { type: true } })
      let node = await scrypta.returnFirstNode()
      let feeds = await scrypta.sendContractRequest(request, node)

      for (let k in feeds) {
        let url = feeds[k].feed
        let feed = await parser.parseURL(url);
        console.log('PARSING FEED: ' + feed.title);

        let i = 0
        let xsid = await scrypta.readxKey(process.env.MAIN_PWD, process.env.MAIN_SID)

        if (xsid !== false) {
          let hashmanager = await scrypta.hash(feeds[k].manager)
          let pathmanager = await scrypta.hashtopath(hashmanager)
          let masterKey = await scrypta.deriveKeyFromSeed(xsid.seed, pathmanager)
          console.log(pathmanager)
          console.log('MASTER KEY IS', masterKey.pub)
          let masterBalance = await scrypta.get('/balance/' + masterKey.pub)

          if (masterBalance.balance > 0.5) {
            for (let k in feed.items) {
              let item = feed.items[k]
              console.log('CHECKING ITEM #' + i, item.title)
              console.log('-> PUBLISHED AT ' + item.link)
              console.log('--> WRITTEN BY ' + item.creator)
              let hash = await scrypta.hash(masterKey.pub + '*' + item.creator)
              let path = await scrypta.hashtopath(hash)
              let authorKey = await scrypta.deriveKeyFromSeed(xsid.seed, path)

              let author = {
                name: item.creator,
                hash: hash,
                address: authorKey.pub,
                prv: authorKey.prv,
                path: path,
                xpub: xsid.xpub
              }

              console.log('---> AUTHOR ADDRESS IS', authorKey.pub)

              item.compressed = LZUTF8.compress(item['content:encoded'], { outputEncoding: 'Base64' })
              item.creator = LZUTF8.compress(item.creator, { outputEncoding: 'Base64' })
              item.title = LZUTF8.compress(item.title, { outputEncoding: 'Base64' })
              item.link = LZUTF8.compress(item.link, { outputEncoding: 'Base64' })
              item.guid = LZUTF8.compress(item.guid, { outputEncoding: 'Base64' })
              item.tags = LZUTF8.compress(JSON.stringify(item.categories), { outputEncoding: 'Base64' })

              item['pubdate'] = item['isoDate']
              item['version'] = 2
              delete item['content:encoded']
              delete item['content:encodedSnippet']
              delete item['dc:creator']
              delete item['categories']
              delete item['pubDate']
              delete item['content']
              delete item['contentSnippet']
              delete item['isoDate']

              let signed = await scrypta.signMessage(masterKey.prv, JSON.stringify(item))
              let toStore = JSON.stringify(signed)

              let uuid = ''
              let guidHash = await scrypta.hash(item.guid)
              let newsHash = await scrypta.hash(toStore)
              let needWrite = false
              let check = await scrypta.post('/read', { address: author.address, refID: guidHash, protocol: 'news://' })
              if (check.data.length === 0) {
                needWrite = true
              } else {
                let toCheck = check.data[0].data
                let checkHash = await scrypta.hash(JSON.stringify(toCheck))
                if (checkHash !== newsHash) {
                  console.log('HASH IS CHANGED, NEED TO UPDATE!')
                  uuid = check.data[0].uuid
                  needWrite = true
                } else {
                  console.log('HASH NOT CHANGED, IGNORING NEWS.')
                }
              }

              if (needWrite) {
                let balance = await scrypta.get('/balance/' + author.address)
                console.log('----> BALANCE IS', balance.balance, 'LYRA')
                let bytes = toStore.length
                let fees = Math.ceil(bytes / 7500) * 0.001
                console.log('-----> FEES ARE', fees, 'LYRA')

                if (balance.balance < fees) {
                  console.log('-----> NEED TO FUND ADDRESS', author.address)
                  let funded = await scrypta.fundAddress(masterKey.prv, author.address, fees)
                  await scrypta.sleep(1000)
                  if (funded === true) {
                    balance = await scrypta.get('/balance/' + author.address)
                  } else {
                    console.log('ERROR WHILE FUNDING ADDRESS')
                  }
                }

                if (balance.balance >= fees) {
                  console.log('WRITING NEWS INTO THE BLOCKCHAIN!')
                  let wallet = await scrypta.importPrivateKey(author.prv, 'TEMPORARY', false)
                  scrypta.debug = true
                  let stored = await scrypta.write(wallet.walletstore, 'TEMPORARY', toStore, '', guidHash, 'news://', uuid)
                  if (stored !== false) {
                    console.log('WRITTEN CORRECTLY INTO THE BLOCKCHAIN!')
                  } else {
                    console.log('ERROR WHILE WRITING NEWS')
                  }
                  await scrypta.sleep(2000)
                  scrypta.debug = false

                }
              }

              i++
            }
          } else {
            console.log('MASTER BALANCE IS TOO LOW', masterBalance.balance, 'LYRA')
          }
        } else {
          console.log('ERROR WHILE READING xSID')
        }
      }

      isParsing = false

    } catch (e) {
      isParsing = false
    }
  }
}

bootstrap()