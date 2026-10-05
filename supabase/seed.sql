-- ============================================================================
-- abroadboard: sample events and meetups
-- Run this in Supabase Dashboard > SQL Editor AFTER schema.sql, and after at
-- least one person has signed up (ideally an admin). The samples are posted
-- under that account's name. Safe to run again: it skips samples that exist.
--
-- Posts disappear after 21 days and events once they're over, so run it again
-- later if you want fresh samples (event dates are counted from today).
-- ============================================================================

do $$
declare
  host uuid;
begin
  -- Post as the first admin, or the first person who signed up.
  select id into host from public.profiles
  order by is_admin desc, created_at
  limit 1;

  if host is null then
    raise exception 'No accounts yet. Sign up on the site once, then run this file again.';
  end if;

  -- Events (Events page)
  insert into public.events (title, event_date, venue, blurb, host_id)
  select v.title, current_date + v.days, v.venue, v.blurb, host
  from (values
    ('International welcome potluck', 3, 'Albert Park, by the fountain',
     'Bring a dish from home and meet other new arrivals from every Auckland campus. Plates and cutlery provided.'),
    ('Sunset walk up Maungawhau / Mt Eden', 6, 'Meet at the Mt Eden summit car park',
     'An easy 30-minute walk to the top for city views at sunset. Wear good shoes and bring a jacket.'),
    ('Language exchange night', 9, 'Central city library, level 2',
     'Practise English or teach a bit of your own language. Tables for Mandarin, Hindi, Korean, Spanish and more.'),
    ('Budget grocery walk', 12, 'Meet outside Britomart station',
     'We visit two supermarkets and a vege market and compare prices for a week of meals. Bring a reusable bag.')
  ) as v(title, days, venue, blurb)
  where not exists (select 1 from public.events e where e.title = v.title);

  -- Meetup posts (Board, "Meetups" category)
  insert into public.posts (section, category, title, body, contact, author_id)
  select 'board', 'Meetups', v.title, v.body, v.contact, host
  from (values
    ('Rangitoto hike this Sunday, who''s in?',
     'Catching the morning ferry from downtown and walking to the summit. Slow pace with lots of photo stops. Bring water and lunch.',
     'Reply here or message on the board'),
    ('Casual cricket in the Domain, Saturday 2pm',
     'All levels welcome. We have a bat and tennis balls. Look for the red umbrella near the duck pond.',
     'Just turn up'),
    ('Board games and snacks from home, Friday night',
     'Catan, Codenames and Uno, plus food from our home countries to share. Around 8 people so far, room for more.',
     'Reply here to get the address'),
    ('Weekly study session at the library',
     'Students from any institution welcome. Quiet study with a coffee break every hour. Tuesdays 6 to 9pm.',
     'Look for the abroadboard sign on the table')
  ) as v(title, body, contact)
  where not exists (select 1 from public.posts p where p.title = v.title);
end;
$$;
