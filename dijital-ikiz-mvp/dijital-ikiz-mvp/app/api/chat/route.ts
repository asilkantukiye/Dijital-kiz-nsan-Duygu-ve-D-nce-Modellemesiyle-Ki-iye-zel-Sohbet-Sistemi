import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { analyzeMessage, profileToSystemPrompt, TwinProfile } from '@/lib/twin'
import { qwenChat } from '@/lib/huggingface'

export async function POST(req: Request){
 try{
  const body=await req.json(); const message=String(body.message||'').trim(); const history=Array.isArray(body.history)?body.history:[]
  if(!message)return NextResponse.json({error:'Mesaj boş.'},{status:400})
  const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser(); if(!user)return NextResponse.json({error:'Oturum bulunamadı.'},{status:401})
  const {data:existing}=await supabase.from('twin_profiles').select('profile').eq('user_id',user.id).maybeSingle()
  const profile=analyzeMessage(message,(existing?.profile||null) as TwinProfile|null)
  const system=`Sen Dijital İkiz İnsan adlı deneysel bir araştırma prototipinin sohbet motorusun. Türkçe konuş. Kullanıcının gerçek kimliğini taklit ettiğini veya onun adına gerçek dünyada işlem yaptığını iddia etme. Psikolojik tanı koyma. Yanıtlarını doğal ve kısa tut. ${profileToSystemPrompt(profile)}`
  const safeHistory=history.slice(-8).filter((m:any)=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string')
  const reply=await qwenChat([{role:'system',content:system},...safeHistory,{role:'user',content:message}])
  await supabase.from('twin_profiles').upsert({user_id:user.id,profile,updated_at:new Date().toISOString()},{onConflict:'user_id'})
  await supabase.from('messages').insert([{user_id:user.id,role:'user',content:message,profile_snapshot:profile},{user_id:user.id,role:'assistant',content:reply,profile_snapshot:profile}])
  return NextResponse.json({reply,profile})
 }catch(e:any){return NextResponse.json({error:e.message||'Sunucu hatası'},{status:500})}
}
