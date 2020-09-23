import { Injectable } from '@nestjs/common'
const ScryptaCore = require('@scrypta/core')
require('dotenv').config()
import * as PouchDB from 'pouchdb'

@Injectable()
export class AppService {
  async getIdanodeStatus(): Promise<string> {
    const scrypta = new ScryptaCore
    let status = await scrypta.get('/wallet/getinfo')
    return status;
  }

  async postRequest(request): Promise<string> {
    const scrypta = new ScryptaCore
    let response = await scrypta.post(request.endpoint, request.params)
    return response;
  }

  async getRequest(request): Promise<string> {
    const scrypta = new ScryptaCore
    let response = await scrypta.get(request.endpoint)
    return response;
  }

  async returnAuthor(request): Promise<Object> {
    const scrypta = new ScryptaCore
    let xsid = await scrypta.readxKey(process.env.MAIN_PWD, process.env.MAIN_SID)
    if (xsid !== false) {
      let hash = await scrypta.hash(request.name)
      let path = await scrypta.hashtopath(hash)
      let derived = await scrypta.deriveKeyfromXPub(xsid.xpub, path)

      let author = {
        name: request.name,
        hash: hash, 
        address: derived.pub,
        path: path,
        xpub: xsid.xpub
      }
      
      return author;
    }else{
      return { message: "Error while obtaining author.", error: true}
    }
  }
}
