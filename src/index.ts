import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers'
import { ProxyToDO } from '../../../projects/workers-mcp/src/modules/ProxyToDO'
import { EmailMessage } from 'cloudflare:email'
import { createMimeMessage } from 'mimetext'
import { getCurrentColo, once, randomString } from './utils'
import PostalMime from 'postal-mime'

const FROM_ADDRESS = 'me@gmad.dev'

export class DurableMCP extends DurableObject<Env> {
  state = once(this.ctx, {
    session_id: randomString,
    colo: getCurrentColo,
    messages: () => [] as string[],
  })

  /**
   * A friendly way to greet the user.
   *
   * @param {string} name The name provided to a Durable Object instance from a Worker
   * @return { Promise<string> } The greeting to be sent back to the Worker
   */
  async sayHello(name: string): Promise<string> {
    return `Hello, ${name} from ${this.state.session_id} (${this.#base64ID()})!`
  }

  /**
   * Send a text or HTML email to an arbitrary recipient.
   *
   * @param {string} recipient - The email address of the recipient.
   * @param {string} subject - The subject of the email.
   * @param {string} contentType - The content type of the email. Can be text/plain or text/html
   * @param {string} body - The body of the email. Must match the provided contentType parameter
   * @return {Promise<string>} A success message.
   * @throws {Error} If the email fails to send, or if that destination email address hasn't been verified.
   */
  async sendEmail(recipient: string, subject: string, contentType: string, body: string) {
    const msg = createMimeMessage()
    console.log(`Instance ${this.state.session_id} sending message!`)

    msg.setSender({ name: 'g-mad', addr: FROM_ADDRESS })
    msg.setRecipient(recipient)
    msg.setSubject(subject)
    msg.addMessage({
      contentType: contentType,
      data: body,
    })
    msg.setHeader('Message-ID', `<${this.#base64ID()}@gmad.dev>`)

    try {
      await this.env.EMAIL.send(new EmailMessage(FROM_ADDRESS, recipient, msg.asRaw()))
    } catch (e) {
      return `Error: ${e.message}`
    }
    return 'Email sent successfully!'
  }

  /**
   * Check for any replies to your latest email. Checking does not clear the list, you must call .clearReplies for that.
   *
   * @return {string} the text contents of any email replies that have been received, delineated with '========='
   * */
  async checkReplies() {
    return this.state.messages.join('\n=========\n')
  }

  /**
   * Clear replies, once you've downloaded them and interpreted them.
   *
   * @return {string} A success message
   * */
  async clearReplies() {
    const num_message = this.state.messages.length
    this.state.messages = []
    this.ctx.storage.put('messages', this.state.messages)
    return `Successfully cleared ${num_message} message(s).`
  }

  /**
   * @ignore
   * */
  async receiveEmail(contents: string) {
    console.log({ contents })
    this.state.messages.push(`== EMAIL RECEIVED AT ${new Date()} ==\n\n${contents}`)
    this.ctx.storage.put('messages', this.state.messages)
    return `We got your reply!\n\nSent by ${this.state.session_id} (${this.#base64ID()})`
  }

  #base64ID() {
    return Buffer.from(this.ctx.id.toString(), 'hex').toString('base64')
  }
}

/**
 * Public HTTP worker that proxies to a DO, using the 'prependSessionID' strategy
 *
 * @do-proxy-prepend-session-id DurableMCP
 * */
export default class EmailDemo extends WorkerEntrypoint<Env> {
  /**
   * @ignore
   * */
  async fetch(request: Request): Promise<Response> {
    return new ProxyToDO(this.env, 'DURABLE_MCP', {
      prependSessionID: true,
    }).fetch(request)
  }

  /**
   * @ignore
   * */
  async email(message: ForwardableEmailMessage) {
    console.log(Object.fromEntries(message.headers.entries()))
    const parsed = await PostalMime.parse(message.raw)
    console.log(parsed)

    // const msg = createMimeMessage()
    // msg.setHeader('In-Reply-To', message.headers.get('Message-ID')!)
    // msg.setSender({ name: 'g-mad', addr: FROM_ADDRESS })
    // msg.setRecipient(message.from)
    // msg.setSubject(`Re: ${message.headers.get('subject')}`)

    const do_match = message.headers.get('references')?.match(/<([A-Za-z0-9+\/]{43}=)@gmad.dev>/)
    if (do_match) {
      const [_, do_id] = do_match

      try {
        const ns = this.env.DURABLE_MCP
        const stub = ns.get(ns.idFromString(Buffer.from(do_id, 'base64').toString('hex')))
        await stub.receiveEmail(parsed.text!)
        // msg.addMessage({
        //   contentType: 'text/plain',
        //   data: ,
        // })
      } catch (e) {
        console.error(e)
        // msg.addMessage({ contentType: 'text/plain', data: 'Something went wrong! Check the logs!' })
      }
    }

    // return message.reply(new EmailMessage(FROM_ADDRESS, message.from, msg.asRaw()))
  }
}
