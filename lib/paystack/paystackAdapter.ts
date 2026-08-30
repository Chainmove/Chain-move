import axios from "axios"
import {
  AcceptNormalizedTxQuery,
  FetchTransactionsQuery,
  IPaystackAdapter,
  NormalizedPaystackTransaction,
  PaystackPaginatedResponse,
  PaystackTransactionRecord,
} from "./types"

export class PaystackAdapter implements IPaystackAdapter {
  private secretKey: string
  private baseUrl: string
  private maxRetries: number

  constructor(secretKey = process.env.PAYSTACK_SECRET_KEY || "", maxRetries = 3) {
    this.secretKey = secretKey
    this.baseUrl = "https://api.paystack.co"
    this.maxRetries = maxRetries
  }

  private async requestWithRetry<T>(url: string, params: Record<string, any> = {}): Promise<T> {
    let attempts = 0
    let delay = 500

    while (attempts < this.maxRetries) {
      try {
        attempts++
        const response = await axios.get(url, {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
          },
          params,
          timeout: 10000,
        })
        return response.data
      } catch (error: any) {
        const statusCode = error.response?.status
        const isTransient = statusCode === 429 || (statusCode >= 500 && statusCode < 600)

        if (isTransient && attempts < this.maxRetries) {
          await new Promise((res) => setTimeout(res, delay))
          delay *= 2
        } else {
          throw new Error(
            `Paystack API Request Failed [HTTP ${statusCode || "NET_ERR"}]: ${error.response?.data?.message || error.message}`,
          )
        }
      }
    }

    throw new Error(`Paystack API Request Failed after ${this.maxRetries} retry attempts`)
  }

  async fetchTransactions(
    query: FetchTransactionsQuery,
  ): Promise<PaystackPaginatedResponse<PaystackTransactionRecord>> {
    const url = `${this.baseUrl}/transaction`
    const params: Record<string, any> = {
      page: query.page || 1,
      perPage: query.perPage || 50,
    }

    if (query.from) params.from = query.from
    if (query.to) params.to = query.to
    if (query.status) params.status = query.status

    return this.requestWithRetry<PaystackPaginatedResponse<PaystackTransactionRecord>>(url, params)
  }

  async verifyTransaction(reference: string): Promise<PaystackTransactionRecord | null> {
    try {
      const url = `${this.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`
      const res = await this.requestWithRetry<{ status: boolean; data: PaystackTransactionRecord }>(url)
      return res.data || null
    } catch (err) {
      return null
    }
  }

  async acceptNormalizedTransactions(
    query: AcceptNormalizedTxQuery,
  ): Promise<{ accepted: number; rejected: number; errors: string[] }> {
    const errors: string[] = []
    let accepted = 0
    let rejected = 0

    for (const tx of query.transactions) {
      if (!tx.reference) {
        errors.push(`Missing reference at index ${accepted + rejected}`)
        rejected++
        continue
      }
      if (tx.amount <= 0) {
        errors.push(`Invalid amount for reference ${tx.reference}`)
        rejected++
        continue
      }
      accepted++
    }

    return { accepted, rejected, errors }
  }
}
