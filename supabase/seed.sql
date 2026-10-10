-- ============================================================================
-- abroadboard: sample events, posts, Buy and Sell listings and food tips
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
  -- More events
  insert into public.events (title, event_date, venue, blurb, host_id)
  select v.title, current_date + v.days, v.venue, v.blurb, host
  from (values
    ('Night market food crawl', 9, 'Meet at the night market entrance',
     'Try street food from a dozen countries for under $20. We will split into small groups so nobody gets lost.'),
    ('Free museum afternoon', 13, 'Auckland War Memorial Museum, main entrance',
     'Entry is free for Auckland residents with ID. We will visit the Māori Court and the volcanoes gallery together.')
  ) as v(title, days, venue, blurb)
  where not exists (select 1 from public.events e where e.title = v.title);

  -- Board posts in other categories, Buy and Sell listings and food tips.
  -- Contact details stay hidden; requests go to the account the samples are posted under.
  with v(section, category, title, body, price, condition, gender, sleeper, note) as (values
    ('board', 'Housing', 'Room available in a Mt Eden flat from 1 November',
     'Furnished double room in a 3-bedroom flat, 10 minutes by bus to the city. $230 a week including power and Wi-Fi. Looking for a tidy, quiet flatmate.',
     null, null, 'any', 'light', 'Non-smoker'),
    ('board', 'Housing', 'Looking for a third flatmate near the city campuses',
     'Two students looking for one more person to share a 3-bedroom apartment in the CBD from December. About $260 a week each.',
     null, null, 'women', 'any', null),
    ('board', 'Study buddies', 'Statistics study partner wanted',
     'Taking first-year statistics and want someone to go through tutorial questions with. Weekdays after 4pm at any city library.',
     null, null, 'any', 'any', null),
    ('board', 'Study buddies', 'IELTS speaking practice partner',
     'Preparing for the IELTS speaking test. Happy to meet twice a week on campus or online to practise together.',
     null, null, 'any', 'any', null),
    ('board', 'Help', 'Which mobile plan is best for students?',
     'Just arrived and need a SIM card. Which provider gives the best value for data and for calling home?',
     null, null, 'any', 'any', null),
    ('board', 'Help', 'How do I get an IRD number for part-time work?',
     'Got my first casual job offer. What documents did you need, and how long did it take?',
     null, null, 'any', 'any', null),
    ('market', 'Furniture', 'Study desk and chair',
     'White desk, 120 cm wide, with a matching chair. Pick up in Newmarket.',
     '$45', 'Good', 'any', 'any', null),
    ('market', 'Electronics', '27-inch monitor with HDMI cable',
     'Barely used and works perfectly. Great as a second screen for assignments.',
     '$90', 'Like new', 'any', 'any', null),
    ('market', 'Books & study', 'First-year economics textbook',
     'Some highlighting in the first chapters, otherwise clean. Pick up on campus.',
     '$25', 'Good', 'any', 'any', null),
    ('market', 'Kitchen', 'Rice cooker and kettle bundle',
     'Both work perfectly. Leaving New Zealand in December.',
     '$20', 'Good', 'any', 'any', null),
    ('market', 'Bikes & transport', 'City bike with lock and helmet',
     'Gears work well, a few small scratches. Fits riders about 160 to 180 cm tall.',
     '$120', 'Fair', 'any', 'any', null),
    ('food', 'Tip', 'Supermarket markdowns after 7pm',
     'Bakery and deli items are often reduced near closing time. Look for the yellow stickers.',
     'Up to 50% off', null, 'any', 'any', null),
    ('food', 'Tip', 'Weekend vege market',
     'Buy a week of fruit and vegetables in one trip. Go near closing time for the best deals.',
     '~$20/week', null, 'any', 'any', null),
    ('food', 'Tip', 'Cook-once, eat-three-times dal',
     'Lentils, onion, tomato and spices. Freezes well and costs very little per serve.',
     '~$2/serve', null, 'any', 'any', null),
    ('food', 'Tip', 'Bring your own lunch box',
     'Most campuses have microwaves in student lounges. Packing lunch can save around $60 a week.',
     'Free', null, 'any', 'any', null)
  ), ins as (
    insert into public.posts (section, category, title, body, price, condition, audience_gender, audience_sleeper,
                              audience_note, contact_methods, author_id)
    select v.section, v.category, v.title, v.body, v.price, v.condition, v.gender, v.sleeper, v.note,
           case when v.section = 'food' then '{}'::text[] else array['email'] end, host
    from v
    where not exists (select 1 from public.posts p where p.title = v.title)
    returning id, section
  )
  insert into public.post_contacts (post_id, email)
  select id, 'info@abroadboard.com' from ins where section <> 'food';
end;
$$;
