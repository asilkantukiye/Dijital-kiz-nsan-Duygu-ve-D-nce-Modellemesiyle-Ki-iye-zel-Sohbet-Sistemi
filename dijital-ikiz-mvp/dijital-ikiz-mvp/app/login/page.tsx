import { redirect } from 'next/navigation'

export default function LoginRedirect(): never {
  redirect('/')
}
