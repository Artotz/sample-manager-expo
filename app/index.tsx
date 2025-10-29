import { Redirect, type Href } from "expo-router"

import { getToken } from "@/lib/session"

export default function Index() {
  const token = getToken()
  const target = (token ? "/amostra" : "/login") as Href
  return <Redirect href={target} />
}
